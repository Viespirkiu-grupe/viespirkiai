import puppeteer from "puppeteer";
import PQueue from "p-queue";
import config from "./config.js";

const PORT = config.port || 8000;
let browserPromise;

// Queue: max 4 pages at the same time
const queue = new PQueue({ concurrency: 4 });

async function initBrowser() {
    if (!browserPromise) {
        browserPromise = puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=MediaQueryPrefersColorScheme",
            ],
        });
    }
    return browserPromise;
}

export async function getOpenGraphImage(tipas, pavadinimas, aprasymas, id) {
    return queue.add(async () => {
        const url =
            `http://localhost:${PORT}/openGraph?` +
            `tipas=${encodeURIComponent(tipas)}` +
            `&pavadinimas=${encodeURIComponent(pavadinimas)}` +
            `&aprasymas=${encodeURIComponent(aprasymas)}` +
            `&id=${encodeURIComponent(id)}`;

        const startTime = Date.now();

        const browser = await initBrowser();
        const page = await browser.newPage();
        await page.setCacheEnabled(false);

        try {
            await page.setViewport({ width: 1200, height: 630 });
            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 10000,
            });
            await page.evaluate(() => document.fonts.ready);

            const buffer = await page.screenshot({
                type: "png",
                captureBeyondViewport: false,
            });

            const duration = Date.now() - startTime;
            return buffer;
        } finally {
            await page.close();
        }
    });
}

export async function serveOpenGraphImage(
    res,
    title,
    subtitle,
    description,
    code,
) {
    const pngBuffer = await getOpenGraphImage(
        title,
        subtitle,
        description,
        code,
    );

    res.set("Cache-Control", "public, max-age=7200, s-maxage=7200");
    res.setHeader("Content-Type", "image/png");
    res.send(pngBuffer);
}

process.on("SIGINT", async () => {
    if (browserPromise) {
        const browser = await browserPromise;
        await browser.close();
    }
    process.exit();
});
