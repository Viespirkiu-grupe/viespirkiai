import { postgres } from "../../postgres/postgres.js";
import { scrapeAllFrom, scrapeDay } from "../etar/scrape.js";

async function run() {
    const args = process.argv.slice(2);
    const date = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));

    if (args.includes("--day")) {
        if (!date) throw new Error("--day režimui būtina YYYY-MM-DD data");
        await scrapeDay(date);
        return;
    }

    const total = await scrapeAllFrom(date ?? "1800-01-01");
    console.log(`e-TAR inventoriaus backfill baigtas: ${total} įrašų`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run().finally(() => postgres.end());
}
