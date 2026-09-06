import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

/**
 * Įrašo į `rcJar."dokumentuEile"` visus JAR kodus, kurių ten dar nėra.
 * Nauji juridiniai asmenys atsiranda `rcJar."asmenys"` po JAR CSV importo,
 * tad šis darbas sukamas kasdien ir paprastai neranda nieko.
 *
 * @param {import("pg").Pool|import("pg").PoolClient} [db]
 * @returns {Promise<number>} kiek kodų pridėta
 */
export async function papildytiDokumentuEile(db = postgres) {
    const rezultatas = await db.query(
        `INSERT INTO "rcJar"."dokumentuEile" ("jarKodas")
         SELECT a."jarKodas"
         FROM "rcJar"."asmenys" a
         WHERE NOT EXISTS (
             SELECT 1 FROM "rcJar"."dokumentuEile" e
             WHERE e."jarKodas" = a."jarKodas"
         )
         ON CONFLICT ("jarKodas") DO NOTHING`,
    );
    if (rezultatas.rowCount) {
        log(`Į dokumentų eilę pridėta JAR kodų: ${rezultatas.rowCount}`);
    }
    return rezultatas.rowCount;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    try {
        const pridėta = await papildytiDokumentuEile();
        log(`Eilė papildyta (${pridėta} nauji kodai)`);
    } finally {
        await postgres.end();
    }
}
