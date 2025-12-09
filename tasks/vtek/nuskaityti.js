/*
 * Nuskaito privačių interesų deklraracijų duomenis pagal duomenų bazėje esančius UUID
 */

import { postgres } from "../../postgres/postgres.js";
import { spawn } from "child_process";
import { log } from "../../utils/log.js";

/**
 * Nuskaito vieną VTEK deklaraciją iš išorinio šaltinio pagal duomenų bazėje esančius UUID
 * ir įrašo duomenis atgal į duomenų bazę.
 * @returns {Promise<boolean>} Grąžina true, jei buvo nuskaityta deklaracija, false jei nėra daugiau deklaracijų.
 */
export async function nuskaitytiVtekDeklaracija() {
    // Paimame vieną deklaracijos UUID iš duomenų bazės
    let deklaracijaRes = await postgres.query(
        "SELECT * FROM vtek WHERE nuskaitytas IS NULL LIMIT 1",
    );
    if (deklaracijaRes.rowCount === 0) return false;

    // Sudarome URL
    let deklaracija = deklaracijaRes.rows[0];
    let url = `https://pinreg.vtek.lt/external/deklaracijos/${deklaracija.uuid}/view/viesa`;
    log(url);

    // Atliekame HTTP užklausą naudodami curl
    let data = await new Promise((resolve, reject) => {
        const curl = spawn("curl", [
            "-s",
            "-w",
            "%{http_code}",
            "-o",
            "-",
            url,
        ]);

        let output = "";
        curl.stdout.on("data", (chunk) => {
            output += chunk;
        });

        curl.on("close", async (code) => {
            // Last 3 characters are HTTP status code
            let status = output.slice(-3);
            let body = output.slice(0, -3);

            if (status !== "200") {
                log(
                    `Klaida nuskaityti deklaracija ${deklaracija.uuid}: ${status}`,
                );
                await postgres.query(
                    "UPDATE vtek SET nuskaitytas = -1 WHERE uuid = $1",
                    [deklaracija.uuid],
                );
                return reject(
                    new Error(
                        `Klaida nuskaityti deklaracija ${deklaracija.uuid}: ${status}`,
                    ),
                );
            }

            try {
                const data = JSON.parse(body);
                resolve(data);
            } catch (err) {
                reject(err);
            }
        });

        curl.on("error", (err) => {
            reject(err);
        });
    });

    // Apdorojame gautus duomenis
    let asmuo = data.teikejas.vardas + " " + data.teikejas.pavarde;
    let sutuoktinis =
        [data.sutuoktinis?.vardas, data.sutuoktinis?.pavarde]
            .filter(Boolean)
            .join(" ") || null;

    let darbovietesJarKodai = data.darbovietes.map((d) => {
        return d.jaKodas;
    });

    let sutuoktinisDarbovietesJarKodai = [];
    if (data.sutuoktinioDarbovietes) {
        sutuoktinisDarbovietesJarKodai = data.sutuoktinioDarbovietes.map(
            (d) => {
                return d.jaKodas;
            },
        );
    }
    let juridiniaiRysiaiJarKodai = data.rysiaiSuJa.map((d) => {
        return d.jaKodas;
    });
    let pateikimoData = data.pateikimoData;

    // Įrašome duomenis į duomenų bazę
    await postgres.query(
        `UPDATE vtek SET
            nuskaitytas = 1,
            json = $1,
            asmuo = $2,
            sutuoktinis = $3,
            "darbovietesJar" = $4,
            "sutuoktinisDarbovietesJar" = $5,
            "juridiniaiRysiaiJar" = $6,
            "pateikimoData" = $7
        WHERE uuid = $8`,
        [
            data,
            asmuo,
            sutuoktinis,
            darbovietesJarKodai,
            sutuoktinisDarbovietesJarKodai,
            juridiniaiRysiaiJarKodai,
            pateikimoData,
            deklaracija.uuid,
        ],
    );

    log(`Nuskaityta deklaracija ${deklaracija.uuid} t.y. ${asmuo}`);
    return true;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    await nuskaitytiVtekDeklaracija();
    process.exit(0);
}
