import { postgres } from "../postgres/postgres.js";
import {
    createDomenaiSpintaClient,
    syncDomenasToSpinta,
} from "../modules/domenai/spintaSync.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
};

const startAfterId = Number(opt("--after", 0));
const batchSize = Number(opt("--batch", 100));
const limit = Number(opt("--limit", Number.POSITIVE_INFINITY));
const dryRun = flag("--dry-run");
const skipScrapes = flag("--skip-scrapes");

async function main() {
    const spinta = createDomenaiSpintaClient();
    let afterId = startAfterId;
    let processed = 0;
    const total = { insert: 0, patch: 0, delete: 0, unchanged: 0 };

    while (true) {
        const { rows } = await postgres.query(
            `SELECT id, domain
             FROM public.domenai
             WHERE id > $1
             ORDER BY id
             LIMIT $2`,
            [afterId, batchSize],
        );
        if (!rows.length) break;

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
        afterId = Number(rows.at(-1).id);
        console.log(
            `iki id=${afterId} | domenai=${processed} | insert=${total.insert} | patch=${total.patch} | delete=${total.delete} | unchanged=${total.unchanged}`,
        );
    }
}

main()
    .catch((error) => {
        console.error("Failed to sync domenai to Spinta:", error);
        process.exitCode = 1;
    })
    .finally(async () => postgres.end());
