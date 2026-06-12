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

    // --resume-from=YYYY-MM-DD tęsia nuo nurodytos viršutinės datos ribos
    // (iš paskutinės „tęsiama iki ..." eilutės), užuot iš naujo perėjus
    // nuo naujausių įrašų.
    const resumeFrom = args.find((arg) => arg.startsWith("--resume-from="))?.split("=")[1] ?? "";
    if (resumeFrom && !/^\d{4}-\d{2}-\d{2}$/.test(resumeFrom)) {
        throw new Error("--resume-from reikalauja YYYY-MM-DD datos");
    }

    const total = await scrapeAllFrom(date ?? "1800-01-01", { resumeFrom });
    console.log(`e-TAR inventoriaus backfill baigtas: ${total} įrašų`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run().finally(() => postgres.end());
}
