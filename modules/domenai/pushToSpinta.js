import { postgres } from "../../postgres/postgres.js";
import { createArgReader } from "../../utils/cliArgs.js";
import { keysetPages } from "../../utils/keysetPaginate.js";
import { createDomenaiSpintaClient, syncDomenasToSpinta } from "./spintaSync.js";

// Visų domenų sinchronizacija į Spintą.
//   npm run push:domenai -- [--after ID] [--batch N] [--limit N] [--dry-run] [--skip-scrapes]

const { flag, opt } = createArgReader(process.argv.slice(2));
const startAfterId = Number(opt("--after", 0));
const batchSize = Number(opt("--batch", 100));
const limit = Number(opt("--limit", Number.POSITIVE_INFINITY));
const dryRun = flag("--dry-run");
const skipScrapes = flag("--skip-scrapes");

async function main() {
    const spinta = createDomenaiSpintaClient();
    let processed = 0;
    const total = { insert: 0, patch: 0, delete: 0, unchanged: 0 };

    const pages = keysetPages(
        async (cursor, pageLimit) => {
            const { rows } = await postgres.query(
                `SELECT id, domain
                 FROM domenai.domenai
                 WHERE id > $1
                 ORDER BY id
                 LIMIT $2`,
                [cursor, pageLimit],
            );
            return rows;
        },
        { pageSize: batchSize, startAfter: startAfterId, getCursor: (row) => Number(row.id) },
    );

    for await (const { rows, cursor } of pages) {
        for (const row of rows) {
            if (processed >= limit) return;
            const stats = await syncDomenasToSpinta({
                domain: row.domain,
                spinta,
                dryRun,
                skipScrapes,
            });
            for (const key of Object.keys(total)) total[key] += stats[key];
            processed++;
        }
        console.log(
            `iki id=${cursor} | domenai=${processed} | insert=${total.insert} | patch=${total.patch} | delete=${total.delete} | unchanged=${total.unchanged}`,
        );
    }
}

main()
    .catch((error) => {
        console.error("Failed to sync domenai to Spinta:", error);
        process.exitCode = 1;
    })
    .finally(async () => postgres.end());
