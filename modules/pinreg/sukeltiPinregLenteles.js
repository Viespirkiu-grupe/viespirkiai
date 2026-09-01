import { postgres } from "../../postgres/postgres.js";
import PQueue from "p-queue";
import { log } from "../../utils/log.js";
import { deklaracijaToRysiai, upsertRysiai } from "./rysiaiUtils.js";

const queue = new PQueue({ concurrency: 32 });

let count = 0;
async function sukeltiPinregLenteles() {
    let lastUuid = "00000000-0000-0000-0000-000000000000";

    while (true) {
        const res = await postgres.query(
            `
            SELECT *
            FROM pinreg."deklaracijos"
            WHERE uuid > $1
            ORDER BY uuid
            LIMIT 1000
            `,
            [lastUuid],
        );

        if (res.rows.length === 0) break;
        let deklaracijos = res.rows.map((row) => {
            if (row.json) {
                return row.json;
            }
            return null;
        });

        // Remove nulls
        deklaracijos = deklaracijos.filter((item) => item !== null);

        await Promise.all(
            deklaracijos.map((deklaracija) =>
                queue.add(async () => {
                    count++;
                    log(`${deklaracija.accessUuid}, ${count}`);

                    // Delete old entries for this declaration
                    await postgres.query(
                        `DELETE FROM pinreg."juridiniaiRysiai" WHERE "deklaracija" = $1`,
                        [deklaracija.accessUuid],
                    );

                    const allRows = deklaracijaToRysiai(deklaracija);

                    const client = await postgres.connect();
                    try {
                        await client.query("BEGIN");
                        await upsertRysiai(
                            client,
                            deklaracija.accessUuid,
                            allRows,
                        );
                        await client.query("COMMIT");
                    } catch (err) {
                        await client.query("ROLLBACK");
                        throw err;
                    } finally {
                        client.release();
                    }
                }),
            ),
        );

        lastUuid = res.rows[res.rows.length - 1].uuid;
    }
}

await sukeltiPinregLenteles();
postgres.end();
