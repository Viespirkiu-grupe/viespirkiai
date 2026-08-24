/*
Pilnas juridinių asmenų Typesense indekso perkėlimas.

Į "juridiniaiTypesenseQueue" sudeda visus public."juridiniai" kodus — eilę
nudreniruoja įprastas procesas (`npm run juridiniai:typesense`) arba TaskRunner.

Reikalingas po Typesense schemos versijos pakėlimo: ensureJarCollection() tokiu
atveju kolekciją ištrina ir sukuria naują, tad ją reikia užpildyti iš naujo.
*/

import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

/**
 * @param {import("pg").Pool | import("pg").PoolClient} [db]
 * @returns {Promise<number>} Į eilę įdėtų įrašų skaičius
 */
export async function requeueJuridiniaiTypesense(db = postgres) {
    const result = await db.query(
        `INSERT INTO public."juridiniaiTypesenseQueue" ("jarKodas", "keitimas")
         SELECT "jarKodas", 'insert' FROM public."juridiniai"`,
    );

    if (result.rowCount > 0) {
        signalWork(WORK_SIGNALS.JURIDINIAI_INDEX_READY, {
            source: "typesense-requeue",
            count: result.rowCount,
        });
    }
    return result.rowCount;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const count = await requeueJuridiniaiTypesense();
    log(`Į Typesense eilę įdėta ${count} juridinių asmenų`);
    await postgres.end();
    process.exit(0);
}
