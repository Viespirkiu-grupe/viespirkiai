import { postgres } from "../../postgres/postgres.js";
import { spawn } from "child_process";
import { log } from "../../utils/log.js";
import { sleep } from "../../utils/time.js";

const BASE_URL = "https://pinreg.vtek.lt/external/deklaracijos/viesa";
const PARAMS_BASE =
    "irasuSkaiciusPuslapyje=50&rusiuojamiStulpeliai=PID_TEIKIMO_DATA&rusiavimoKryptis=DESC&v=523b0df25";

const LETTERS = [
    "a",
    "ą",
    "b",
    "c",
    "č",
    "d",
    "e",
    "ę",
    "ė",
    "f",
    "g",
    "h",
    "i",
    "į",
    "y",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "r",
    "s",
    "š",
    "t",
    "u",
    "ū",
    "v",
    "z",
    "ž",
];

const PAGE_ESCALATE_AT = 190;
const SLEEP_MS = 100;

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

async function crawlPrefix(prefix) {
    log(`Pavarde: ${prefix}`);
    let page = 1;
    let escalate = false;

    while (true) {
        const url = `${BASE_URL}?${PARAMS_BASE}&pavarde=${prefix}&puslapioNr=${page}`;

        const { status, data } = await curlFetch(url);
        log(`${prefix} page ${page} [${status}]`);

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

        for (const row of items) {
            if (row.accessUuid) {
                await postgres.query(
                    `INSERT INTO pinreg (uuid) VALUES ($1) ON CONFLICT DO NOTHING;`,
                    [row.accessUuid],
                );
            }
        }

        if (page >= PAGE_ESCALATE_AT) {
            escalate = true;
            break;
        }

        page++;
        await sleep(SLEEP_MS);
    }

    return escalate;
}

/* -------- main -------- */

for (const l1 of LETTERS) {
    const esc1 = await crawlPrefix(l1);
    if (!esc1) continue;

    log(`Escalating → 2 letters: ${l1}`);

    for (const l2 of LETTERS) {
        const p2 = l1 + l2;
        const esc2 = await crawlPrefix(p2);
        if (!esc2) continue;

        log(`Escalating → 3 letters: ${p2}`);

        for (const l3 of LETTERS) {
            await crawlPrefix(p2 + l3);
        }
    }
}

log("Done");
postgres.end();
