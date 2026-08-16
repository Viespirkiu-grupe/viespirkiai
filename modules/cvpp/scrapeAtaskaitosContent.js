/** Compatibility facade for the split CVPP report-content scraper. */
import { postgres } from "../../postgres/postgres.js";
import { parseAtaskaitosLink } from "./ataskaitosContent/primitives.js";
import { scrapeAtaskaitosContent } from "./ataskaitosContent/fetch.js";
import { scrapeVienaAtaskaita } from "./ataskaitosContent/queue.js";

export { parseAtaskaitosLink } from "./ataskaitosContent/primitives.js";
export { scrapeAtaskaitosContent } from "./ataskaitosContent/fetch.js";
export { scrapeVienaAtaskaita } from "./ataskaitosContent/queue.js";

// CLI
//   Be argumentų: pereina per visas eilutes pagal "nuskaitymas" ir įrašo į DB.
//   Dry run (be DB): node scrapeAtaskaitosContent.js <link>
//                    node scrapeAtaskaitosContent.js <id> <formTypeId>
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const [arg1, arg2] = process.argv.slice(2);

    if (!arg1) {
        // Įrašymas į DB: visos eilutės pagal nuskaitymo būseną.
        (async () => {
            while (await scrapeVienaAtaskaita()) {}
            await postgres.end();
            console.log("[CVPP ataskaita] Nuskaitymas baigtas");
        })().catch(async (err) => {
            console.error(err);
            await postgres.end();
            process.exit(1);
        });
    } else {
        // Dry run: priima arba pilną nuorodą, arba <id> <formTypeId>.
        let id = arg1;
        let formTypeId = arg2;
        if (/^https?:\/\//.test(arg1)) {
            ({ id, formTypeId } = parseAtaskaitosLink(arg1));
        }
        if (!id || !formTypeId) {
            console.error(
                "Usage: node scrapeAtaskaitosContent.js            (įrašo visas į DB)\n" +
                    "       node scrapeAtaskaitosContent.js <link>\n" +
                    "       node scrapeAtaskaitosContent.js <id> <formTypeId>",
            );
            process.exit(1);
        }
        scrapeAtaskaitosContent(id, formTypeId)
            .then((data) => {
                console.log(JSON.stringify(data, null, 2));
            })
            .finally(() => postgres.end());
    }
}
