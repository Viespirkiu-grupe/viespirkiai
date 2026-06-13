import { postgres } from "../postgres/postgres.js";
import {
    createSutartysSpintaClient,
    syncSutartysToSpinta,
} from "../modules/sutartys/spintaSync.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
};

const startAfterId = Number(opt("--after", 0));
const batchSize = Number(opt("--batch", 100));
const dryRun = flag("--dry-run");

async function main() {
    const spinta = createSutartysSpintaClient();
    let afterId = startAfterId;
    let processed = 0;
    const total = { insert: 0, patch: 0, delete: 0, unchanged: 0 };

    while (true) {
        const { rows } = await postgres.query(
            `SELECT "sutartiesUnikalusId"
             FROM public.sutartys
             WHERE "sutartiesUnikalusId" > $1
             ORDER BY "sutartiesUnikalusId"
             LIMIT $2`,
            [afterId, batchSize],
        );
        if (!rows.length) break;

        const ids = rows.map((row) => Number(row.sutartiesUnikalusId));
        const stats = await syncSutartysToSpinta({ ids, spinta, dryRun });
        for (const key of Object.keys(total)) total[key] += stats[key];
        processed += ids.length;
        afterId = ids.at(-1);
        console.log(
            `iki id=${afterId} | sutartys=${processed} | insert=${total.insert} | patch=${total.patch} | delete=${total.delete} | unchanged=${total.unchanged}`,
        );
    }
}

main()
    .catch((error) => {
        console.error("Failed to sync sutartys to Spinta:", error);
        process.exitCode = 1;
    })
    .finally(async () => postgres.end());
