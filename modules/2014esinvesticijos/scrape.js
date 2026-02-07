import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import PQueue from "p-queue";
import RPSCounter from "../../utils/rpsCounter.js";

const rps = new RPSCounter();

let cachedSession = null;
let cachedAt = 0;
const SESSION_TTL = 15 * 60 * 1000; // 15 min

async function getSessionCookie() {
    const now = Date.now();

    if (cachedSession && now - cachedAt < SESSION_TTL) {
        return cachedSession;
    }

    // hit homepage → get PHPSESSID
    const homeRes = await fetch("https://2014.esinvesticijos.lt/lt");
    const setCookie = homeRes.headers.get("set-cookie");
    const phpSessId = setCookie?.match(/PHPSESSID=([^;]+)/)?.[1];

    if (!phpSessId) {
        throw new Error("Nepavyko gauti PHPSESSID");
    }

    const cookie = `PHPSESSID=${phpSessId}`;

    // apply setwrap using SAME session
    await fetch("https://2014.esinvesticijos.lt/lt/general/setwrap", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookie,
        },
        body: new URLSearchParams({
            module: "applications",
            action: "listing_item",
            wrap: "1000",
        }),
    });

    cachedSession = cookie;
    cachedAt = now;

    return cookie;
}

async function upsert2014EsinvesticijosRow(row) {
    await postgres.query(
        `
    INSERT INTO public."2014Esinvesticijos" (
      "kodas", "slug", "pavadinimas", "pareiskejas", "busena",
      "paraiskosVertinimai", "paraiskosSuma", "finansavimas",
      "projektoSuma", "kitasFinansavimas", "galutineSuma", "pabaigosData"
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT ("kodas") DO UPDATE SET
      "slug" = EXCLUDED."slug",
      "pavadinimas" = EXCLUDED."pavadinimas",
      "pareiskejas" = EXCLUDED."pareiskejas",
      "busena" = EXCLUDED."busena",
      "paraiskosVertinimai" = EXCLUDED."paraiskosVertinimai",
      "paraiskosSuma" = EXCLUDED."paraiskosSuma",
      "finansavimas" = EXCLUDED."finansavimas",
      "projektoSuma" = EXCLUDED."projektoSuma",
      "kitasFinansavimas" = EXCLUDED."kitasFinansavimas",
      "galutineSuma" = EXCLUDED."galutineSuma",
      "pabaigosData" = EXCLUDED."pabaigosData"
    `,
        [
            row.kodas,
            row.slug,
            row.pavadinimas,
            row.pareiskejas,
            row.busena,
            JSON.stringify(row.paraiskosVertinimai),
            row.paraiskosSuma,
            row.finansavimas,
            row.projektoSuma,
            row.kitasFinansavimas,
            row.galutineSuma,
            row.pabaigosData,
        ],
    );
}

async function nuskaityti2014EsinvesticijosPuslapi(page) {
    let url = `https://2014.esinvesticijos.lt/lt//finansavimas/paraiskos_ir_projektai?page=${page}`;

    const cookie = await getSessionCookie();

    let response = await fetch(url, {
        headers: {
            Cookie: cookie,
        },
    });

    let text = await response.text();
    rps.record();
    let { document } = parseHTML(text);

    let lentele = document.querySelector(".table > tbody:nth-child(2)");
    if (!lentele) {
        return [];
    }
    const rows = lentele.querySelectorAll("tr");

    const data = Array.from(rows)
        .map((tr) => {
            const tds = tr.querySelectorAll("td");

            if (!tds.length) return null;

            const titleDivs = tds[1]?.querySelectorAll("div");
            const applicationDls = tds[4]?.querySelectorAll("dl");

            return {
                slug:
                    tr.dataset.href?.replace(
                        "//2014.esinvesticijos.lt/lt//finansavimas/paraiskos_ir_projektai/",
                        "",
                    ) || null,
                pavadinimas: titleDivs?.[0]?.textContent.trim() || null,
                kodas: titleDivs?.[1]?.textContent.trim() || null,
                pareiskejas: tds[2]?.textContent.trim() || null,
                busena: tds[3]?.textContent.trim() || null,
                paraiskosVertinimai: applicationDls
                    ? Array.from(applicationDls).map((dl) => {
                          const dt =
                              dl.querySelector("dt")?.textContent.trim() ||
                              null;
                          let ddRaw =
                              dl.querySelector("dd")?.textContent.trim() ||
                              null;

                          if (!ddRaw)
                              return {
                                  pavadinimas: dt,
                                  rezultatas: null,
                                  data: null,
                              };

                          // Išskiriame datą skliausteliuose
                          const match = ddRaw.match(/\((\d{4}-\d{2}-\d{2})\)/);
                          const data = match ? match[1] : null;

                          // pašaliname datą ir papildomas tarpines eilutes
                          const rezultatas =
                              ddRaw
                                  .replace(/\(\d{4}-\d{2}-\d{2}\)/, "")
                                  .trim() || null;

                          return { pavadinimas: dt, rezultatas, data };
                      })
                    : [],

                paraiskosSuma: parseFloat(
                    tds[5]?.textContent
                        .replace(/\s|€/g, "")
                        .replace(",", ".") || 0,
                ),
                finansavimas: parseFloat(
                    tds[6]?.textContent
                        .replace(/\s|€/g, "")
                        .replace(",", ".") || 0,
                ),
                projektoSuma: parseFloat(
                    tds[7]?.textContent
                        .replace(/\s|€/g, "")
                        .replace(",", ".") || 0,
                ),
                kitasFinansavimas: parseFloat(
                    tds[8]?.textContent
                        .replace(/\s|€/g, "")
                        .replace(",", ".") || 0,
                ),
                galutineSuma: parseFloat(
                    tds[9]?.textContent
                        .replace(/\s|€/g, "")
                        .replace(",", ".") || 0,
                ),
                pabaigosData:
                    (tds[10]?.textContent.trim() || null) === "–"
                        ? null
                        : tds[10]?.textContent.trim() || null,
            };
        })
        .filter(Boolean);

    for (const row of data) {
        await upsert2014EsinvesticijosRow(row);
    }
    return data;
}

export async function update2014EsInvesticijosData(starting = 0) {
    let page = starting;
    let totalRecords = 0;
    const results = [];

    while (true) {
        log(`Nuskaitomas puslapis ${page}`);

        const data = await nuskaityti2014EsinvesticijosPuslapi(page);

        if (data.length === 0) {
            log("Nėra daugiau duomenų, baigiama.");
            break;
        }

        totalRecords += data.length;
        log(
            `Puslapyje rasta įrašų: ${data.length}, iš viso: ${totalRecords}, RPS: ${rps.getRPS().toFixed(2)}`,
        );

        results.push(...data);
        page += 1;
    }

    log(`Iš viso nuskaityta įrašų: ${totalRecords}`);
    return results;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    update2014EsInvesticijosData(0)
        .then(() => {
            log("Nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida nuskaitant:", err);
            postgres.end();
        });
}
