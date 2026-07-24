import { pathToFileURL } from "node:url";
import { cvpIsScrapePageContent } from "./scrape.js";
import { prepareScrapedCanonical } from "./prepareScrapedCanonical.js";

export const HELP = "Naudojimas: npm run sutartys:canonical-json -- <unikalusId>";

export async function scrapeSutartisCanonical(unikalusId) {
    const id = String(unikalusId ?? "").trim();
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
        throw new Error(`Neteisingas sutarties unikalus ID: ${JSON.stringify(unikalusId)}`);
    }

    const url =
        "https://eviesiejipirkimai.lt/index.php?option=com_vptpublic" +
        `&task=sutartys&Itemid=109&filter_show=1&filter_limit=10&filter_dok_id=${encodeURIComponent(id)}`;
    const { sutartys } = await cvpIsScrapePageContent(url, {
        useProxy: false,
        recordFailures: false,
    });
    const scraped = sutartys.find(
        (sutartis) => String(sutartis.sutartiesUnikalusID) === id,
    );
    if (!scraped) {
        throw new Error(`Sutartis ${id} nerasta (gauta įrašų: ${sutartys.length})`);
    }

    const canonical = prepareScrapedCanonical(scraped);
    if (!canonical) throw new Error(`Sutartis ${id} neturi tinkamo unikalaus ID`);
    return canonical;
}

export async function main(argv = process.argv.slice(2)) {
    if (argv.length !== 1 || argv[0] === "--help" || argv[0] === "-h") {
        console.log(HELP);
        return argv.length === 1 ? 0 : 1;
    }

    const result = await scrapeSutartisCanonical(argv[0]);
    console.log(`JSON: ${result.json}`);
    console.log(`MD5: ${result.md5}`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().then(
        (code) => { process.exitCode = code; },
        (error) => {
            console.error(error.message);
            process.exitCode = 1;
        },
    );
}
