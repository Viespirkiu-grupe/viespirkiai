import { postgres } from "../../postgres/postgres.js";
import { findSingleJuridinis } from "../juridiniai/search.js";
import { log } from "../../utils/log.js";

async function rastiSavininkuKodus() {
    let res = await postgres.query(
        `SELECT * FROM domenai WHERE savininkas IS NOT NULL AND ("savininkoKodasStatus" IS NULL OR ("savininkoKodasStatus" >= 0 AND "savininkoKodasStatus" < 2)) LIMIT 1;`,
    );

    if (res.rowCount === 0) {
        return false;
    }

    let domenas = res.rows[0];

    let juridinisRes = await findSingleJuridinis(domenas.savininkas);
    if (juridinisRes === null) {
        log(
            `Savininko kodas nerastas: ${domenas.savininkas} (domenas: ${domenas.domain})`,
        );
        await postgres.query(
            `UPDATE domenai SET "savininkoKodas" = NULL, "savininkoKodasStatus" = 2 WHERE savininkas = $1;`,
            [domenas.savininkas],
        );
    } else {
        log(
            `Savininko kodas rastas: ${domenas.savininkas} -> ${juridinisRes.jarKodas} (${juridinisRes.pavadinimas}) (domenas: ${domenas.domain})`,
        );
        await postgres.query(
            `UPDATE domenai SET "savininkoKodas" = $1, "savininkoKodasStatus" = 2 WHERE savininkas = $2;`,
            [juridinisRes.jarKodas, domenas.savininkas],
        );
    }
    return true;
}

while (await rastiSavininkuKodus()) {}
