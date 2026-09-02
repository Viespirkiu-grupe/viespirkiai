import { postgres } from "../../postgres/postgres.js";

export async function gautiIstatiniKapitala(jarId) {
    // Istatinis kapitalas
    let istatinisKapitalas = {};

    if (jarId) {
        const istatinisKapitalasRes = await postgres.query(
            `SELECT data, reiksme, valiuta
               FROM "rcJar"."spintaKapitalas"
               WHERE "jarId" = $1
               ORDER BY "data" DESC`,
            [jarId],
        );

        // Overwrite valiuta Lt → LTL, Eur → EUR
        istatinisKapitalasRes.rows.forEach((row) => {
            if (row.valiuta === "Lt") row.valiuta = "LTL";
            else if (row.valiuta === "Eur") row.valiuta = "EUR";
        });

        if (
            istatinisKapitalasRes.rows &&
            istatinisKapitalasRes.rows.length > 0
        ) {
            istatinisKapitalas = { ...istatinisKapitalasRes.rows[0] }; // clone row 0
            istatinisKapitalas.duomenys = istatinisKapitalasRes.rows; // safe, no self-ref
        }
    }

    return istatinisKapitalas;
}
