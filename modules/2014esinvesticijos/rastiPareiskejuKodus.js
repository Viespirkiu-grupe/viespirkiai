import { postgres } from "../../postgres/postgres.js";
import { findSingleJuridinis } from "../juridiniai/search.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

const STATUS_VERSION = 5;

export async function rastiEsInvesticijosPareiskejoJarKoda() {
    const res = await postgres.query(
        `
        SELECT *
        FROM public."2014Esinvesticijos"
        WHERE pareiskejas IS NOT NULL
          AND (
              "pareiskejasJarKodasStatus" IS NULL
              OR (
                  "pareiskejasJarKodasStatus" >= 0
                  AND "pareiskejasJarKodasStatus" < $1
              )
          )
        LIMIT 1;
        `,
        [STATUS_VERSION],
    );

    if (res.rowCount === 0) {
        return false;
    }

    const projektas = res.rows[0];
    const juridinisRes = await findSingleJuridinis(projektas.pareiskejas);

    if (juridinisRes === null) {
        logger.log(
            `Pareiškėjo JAR kodas nerastas: ${projektas.pareiskejas} (projektas: ${projektas.kodas})`,
        );
        await postgres.query(
            `
            UPDATE public."2014Esinvesticijos"
            SET "pareiskejasJarKodas" = NULL,
                "pareiskejasJarKodasStatus" = $1
            WHERE pareiskejas = $2;
            `,
            [STATUS_VERSION, projektas.pareiskejas],
        );
    } else {
        logger.log(
            `Pareiškėjo JAR kodas rastas: ${projektas.pareiskejas} -> ${juridinisRes.jarKodas} (${juridinisRes.pavadinimas}) (projektas: ${projektas.kodas})`,
        );
        await postgres.query(
            `
            UPDATE public."2014Esinvesticijos"
            SET "pareiskejasJarKodas" = $1,
                "pareiskejasJarKodasStatus" = $2
            WHERE pareiskejas = $3;
            `,
            [juridinisRes.jarKodas, STATUS_VERSION, projektas.pareiskejas],
        );
    }

    return true;
}

while (await rastiEsInvesticijosPareiskejoJarKoda()) {}
