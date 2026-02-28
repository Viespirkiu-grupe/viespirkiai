import { postgres } from "../../postgres/postgres.js";
import config from "../../utils/config.js";
import { SocksProxyAgent } from "socks-proxy-agent";
import { log } from "../../utils/log.js";
import fetch from "node-fetch";
import net from "net";

let proxyAgent = new SocksProxyAgent(config.torAddress);

export function newTorIdentity(password = config.torPassword) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(9051, "127.0.0.1");

        let authenticated = false;

        socket.on("connect", () => {
            socket.write(`AUTHENTICATE "${password}"\r\n`);
        });

        socket.on("data", (data) => {
            const msg = data.toString().trim();

            if (!authenticated) {
                if (msg.startsWith("250")) {
                    // Auth successful
                    authenticated = true;
                    socket.write("SIGNAL NEWNYM\r\n");
                } else {
                    reject(new Error("Tor authentication failed: " + msg));
                }
            } else {
                // Response to SIGNAL NEWNYM
                if (msg.startsWith("250")) {
                    socket.end();
                    resolve();
                } else {
                    reject(new Error("Tor NEWNYM failed: " + msg));
                }
            }
        });

        socket.on("error", reject);
    });
}

const SCRAPE_API = "https://www.domreg.lt/api/whois/details/";
const DOMREG_NUSKAITYMAS = 1;

export async function nuskaitytiDomregDomena() {
    let result = await postgres.query(
        `SELECT * FROM domenai WHERE ("domregNuskaitymas" < $1 AND "domregNuskaitymas" >= 0) OR "domregNuskaitymas" IS NULL LIMIT 1;`,
        [DOMREG_NUSKAITYMAS],
    );
    let domenas = result.rows[0];

    if (!domenas) {
        return false;
    }

    log(domenas.domain);

    if (domenas) {
        try {
            let url = `${SCRAPE_API}${domenas.domain}?_=${new Date().getTime()}`;
            let response = await fetch(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" +
                        "58.0.3029.110 Safari/537.3",
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                    "Cache-Control": "no-cache",
                    Pragma: "no-cache",
                    Connection: "keep-alive",
                },
                agent: proxyAgent,
            });

            let data = await response.json();
            console.log(data);
            const today = new Date().toLocaleDateString("lt-LT", {
                timeZone: "Europe/Vilnius",
            });
            if (data.error === 0) {
                await postgres.query(
                    `UPDATE domenai SET "domregNuskaitymas" = $1, "domregData" = $2, domreg = $3, savininkas = $4, "savininkasAdresas" = $5, status = $6, created = $7, expired = $8, updated = $9, "domregNs" = $10 WHERE id = $11;`,
                    [
                        DOMREG_NUSKAITYMAS,
                        today,
                        data,
                        data.details.registrant.org,
                        data.details.registrant.addr,
                        data.domainstatus,
                        data.details.domain.created,
                        data.details.domain.expired,
                        data.details.domain.updated,
                        data.details.nameservers,
                        domenas.id,
                    ],
                );
            } else if (data.error === 2) {
                await postgres.query(
                    `UPDATE domenai SET "domregNuskaitymas" = $1, "domregData" = $2, "domreg" = $3 WHERE id = $4;`,
                    [-404, today, data, domenas.id],
                );
            } else if (data.error === 100) {
                await newTorIdentity();
                return;
            } else {
                await postgres.query(
                    `UPDATE domenai SET "domregNuskaitymas" = $1, "domregData" = $2, "domreg" = $3 WHERE id = $4;`,
                    [-1, today, data, domenas.id],
                );
            }
        } catch (error) {
            console.error("Error fetching WHOIS data:", error);
        }
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
    while (true) {
        try {
            await nuskaitytiDomregDomena(); // waits for completion
        } catch (err) {
            console.error("Error:", err);
        }
        await sleep(1000); // wait 1s after finishing
    }
})();
