import { postgres } from "../../postgres/postgres.js";
import { spawn } from "child_process";
import { log } from "../../utils/log.js";
import { deklaracijaToRysiai, upsertRysiai } from "./rysiaiUtils.js";

/**
 * Nuskaityti vieną VTEK deklaraciją ir įrašyti į pinreg."juridiniaiRysiai".
 * @returns {Promise<boolean>} true jei nuskaityta, false jei daugiau deklaracijų nėra
 */
export async function nuskaitytiPinregDeklaracija() {
    const deklaracijaRes = await postgres.query(
        `SELECT * FROM pinreg."deklaracijos" WHERE nuskaitytas IS NULL LIMIT 1`,
    );
    if (deklaracijaRes.rowCount === 0) return false;

    const deklaracija = deklaracijaRes.rows[0];
    const url = `https://pinreg.vtek.lt/external/deklaracijos/${deklaracija.uuid}/view/viesa`;
    log(url);

    const data = await new Promise((resolve, reject) => {
        const curl = spawn("curl", [
            "-s",
            "-w",
            "%{http_code}",
            "-o",
            "-",
            url,
        ]);
        let output = "";
        curl.stdout.on("data", (chunk) => (output += chunk));

        curl.on("close", async () => {
            const status = output.slice(-3);
            const body = output.slice(0, -3);

            if (status !== "200") {
                log(
                    `Klaida nuskaityti deklaracija ${deklaracija.uuid}: ${status}`,
                );
                await postgres.query(
                    `UPDATE pinreg."deklaracijos" SET nuskaitytas = -1 WHERE uuid = $1`,
                    [deklaracija.uuid],
                );
                return reject(
                    new Error(
                        `Klaida nuskaityti deklaracija ${deklaracija.uuid}: ${status}`,
                    ),
                );
            }

            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(err);
            }
        });

        curl.on("error", reject);
    });

    // Žymime nuskaitytą
    await postgres.query(
        `UPDATE pinreg."deklaracijos" SET nuskaitytas = 1, json = $1, "pateikimoData" = $2 WHERE uuid = $3`,
        [data, data.pateikimoData ?? null, deklaracija.uuid],
    );

    const allRows = deklaracijaToRysiai(data);
    if (!allRows.length) return true;

    const client = await postgres.connect();
    try {
        await client.query("BEGIN");
        await upsertRysiai(client, data.accessUuid, allRows);
        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
    log(`Nuskaityta deklaracija ${deklaracija.uuid}`);
    return true;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    await nuskaitytiPinregDeklaracija();
    process.exit(0);
}
