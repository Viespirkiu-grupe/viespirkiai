import { postgres } from "../../postgres/postgres.js";
import { findSingleJuridinis } from "../juridiniai/search.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

// Padidinus versiją visi pareiškėjai peržiūrimi iš naujo.
const STATUS_VERSION = 5;

/**
 * Suranda vieno pareiškėjo JAR kodą pagal pavadinimą.
 *
 * Pareiškėjas yra atskira lentelė, todėl paieška daroma kartą įmonei, o ne
 * kiekvienai jos paraiškai (14 tūkst. pareiškėjų vietoje 41 tūkst. paraiškų).
 *
 * @returns {Promise<boolean>} true, jei dar liko neperžiūrėtų pareiškėjų
 */
export async function rastiEsInvesticijosPareiskejoJarKoda() {
    const res = await postgres.query(
        `
        SELECT "id", "pavadinimas"
        FROM "2014esInvesticijos"."pareiskejai"
        WHERE "jarKodasStatus" IS NULL
           OR ("jarKodasStatus" >= 0 AND "jarKodasStatus" < $1)
        LIMIT 1;
        `,
        [STATUS_VERSION],
    );

    if (res.rowCount === 0) {
        return false;
    }

    const pareiskejas = res.rows[0];
    const juridinisRes = await findSingleJuridinis(pareiskejas.pavadinimas);

    if (juridinisRes === null) {
        logger.log(`Pareiškėjo JAR kodas nerastas: ${pareiskejas.pavadinimas}`);
    } else {
        logger.log(
            `Pareiškėjo JAR kodas rastas: ${pareiskejas.pavadinimas} -> ${juridinisRes.jarKodas} (${juridinisRes.pavadinimas})`,
        );
    }

    await postgres.query(
        `
        UPDATE "2014esInvesticijos"."pareiskejai"
        SET "jarKodas" = $1,
            "jarKodasStatus" = $2
        WHERE "id" = $3;
        `,
        [juridinisRes?.jarKodas ?? null, STATUS_VERSION, pareiskejas.id],
    );

    return true;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    while (await rastiEsInvesticijosPareiskejoJarKoda()) {}
    await postgres.end();
}
