import { postgres } from "../../postgres/postgres.js";
import { spawn } from "child_process";
import { log } from "../../utils/log.js";

const BASE_URL = "https://pinreg.vtek.lt/external/deklaracijos/viesa";
const PARAMS_BASE =
    "irasuSkaiciusPuslapyje=50&rusiuojamiStulpeliai=PID_TEIKIMO_DATA&rusiavimoKryptis=DESC&v=523b0df25";

const SLEEP_MS = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curlFetch(url) {
    return new Promise((resolve, reject) => {
        const curl = spawn("curl", [
            "-s",
            "-w",
            "%{http_code}",
            "-o",
            "-",
            url,
        ]);

        let body = "";
        curl.stdout.on("data", (d) => (body += d));
        curl.on("error", reject);

        curl.on("close", () => {
            const status = body.slice(-3);
            const data = body.slice(0, -3);
            resolve({ status, data });
        });
    });
}

export async function getNewestPinreg(upTo = null) {
    let lastDate = new Date();
    let page = 1;
    if (upTo == null) {
        upTo = new Date("2000-01-01T00:00:00Z");
    }

    while (lastDate > upTo) {
        const url = `${BASE_URL}?${PARAMS_BASE}&puslapioNr=${page}`;

        const { status, data } = await curlFetch(url);
        log(`Page ${page} [${status}]`);

        if (status !== "200") break;

        let json;
        try {
            json = JSON.parse(data);
        } catch {
            log("JSON parse failed, stopping prefix");
            break;
        }

        const items = json?.content ?? [];
        if (items.length === 0) {
            log("Empty page, stopping");
            break;
        }

        // Find the last item by pateikimoData
        const lastItem = items[items.length - 1];
        lastDate = new Date(lastItem.pateikimoData);
        log(`Last item date: ${lastDate.toISOString()}`);

        for (const row of items) {
            if (row.accessUuid) {
                await postgres.query(
                    `INSERT INTO pinreg (uuid) VALUES ($1) ON CONFLICT DO NOTHING;`,
                    [row.accessUuid],
                );
            }
        }

        page++;
        await sleep(SLEEP_MS);
    }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    await getNewestPinreg();
    process.exit(0);
}
