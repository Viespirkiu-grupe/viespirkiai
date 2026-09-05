import { postgres } from "../../postgres/postgres.js";
import { createArgReader } from "../../utils/cliArgs.js";
import { keysetPages } from "../../utils/keysetPaginate.js";
import { createSutartysSpintaClient, syncSutartysToSpinta } from "./spintaSync.js";

// Visų sutarčių sinchronizacija į Spintą (vienkartinis/atsistatymo paleidimas –
// kasdien tai daro process:sutartys-adp-queue).
//   npm run push:sutartys -- [--after ID] [--batch N] [--dry-run]

const { flag, opt } = createArgReader(process.argv.slice(2));
const startAfterId = Number(opt("--after", 0));
const batchSize = Number(opt("--batch", 100));
const dryRun = flag("--dry-run");

async function main() {
    const spinta = createSutartysSpintaClient();
    let processed = 0;
    const total = { insert: 0, patch: 0, delete: 0, unchanged: 0 };

    const pages = keysetPages(
        async (cursor, limit) => {
            const { rows } = await postgres.query(
                `SELECT "unikalusId" AS "sutartiesUnikalusId"
                 FROM "vpmSutartys"."sutartys"
                 WHERE "unikalusId" > $1
                 ORDER BY "unikalusId"
                 LIMIT $2`,
                [cursor, limit],
            );
            return rows;
        },
        {
            pageSize: batchSize,
            startAfter: startAfterId,
            getCursor: (row) => Number(row.sutartiesUnikalusId),
        },
    );

    for await (const { rows, cursor } of pages) {
        const ids = rows.map((row) => Number(row.sutartiesUnikalusId));
        const stats = await syncSutartysToSpinta({ ids, spinta, dryRun });
        for (const key of Object.keys(total)) total[key] += stats[key];
        processed += ids.length;
        console.log(
            `iki id=${cursor} | sutartys=${processed} | insert=${total.insert} | patch=${total.patch} | delete=${total.delete} | unchanged=${total.unchanged}`,
        );
    }
}

main()
    .catch((error) => {
        console.error("Failed to sync sutartys to Spinta:", error);
        process.exitCode = 1;
    })
    .finally(async () => postgres.end());
