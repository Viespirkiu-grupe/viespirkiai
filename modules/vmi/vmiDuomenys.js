import { postgres } from "../../postgres/postgres.js";

/**
 * @param {string} jarKodas
 * @param {string | null | undefined} jarId
 */
export async function gautiVmiDuomenis(jarKodas, jarId = null) {
    const { rows: mokesciaiRezultatai } = await postgres.query(
        `SELECT DISTINCT ON (metai, menuo) *
         FROM mokesciai
         WHERE "jarKodas" = $1
            OR ($2::text IS NOT NULL AND mm_kodas_id = $2)
         ORDER BY metai ASC, menuo ASC, ("jarKodas" = $1) DESC, "duomenuData" DESC;`,
        [jarKodas, jarId],
    );

    let mokesciai;

    if (mokesciaiRezultatai.length > 0) {
        const naujausias = mokesciaiRezultatai.at(-1);

        const naudojamiNaujausi = [
            "pavadinimas",
            "jarKodas",
            "formosPavadinimas",
            "suma",
        ];

        mokesciai = {
            ...Object.fromEntries(
                naudojamiNaujausi.map((key) => [key, naujausias[key]]),
            ),
            jarKodas: naujausias.jarKodas || jarKodas,
            data: `${naujausias.metai}-${naujausias.menuo
                .toString()
                .padStart(2, "0")}`,
            duomenuData: new Date(naujausias.duomenuData).toLtDate(),

            duomenys: mokesciaiRezultatai.map((row) => ({
                data: `${row.metai}-${row.menuo.toString().padStart(2, "0")}`,
                duomenuData: new Date(row.duomenuData).toLtDate(),
                suma: row.suma,
            })),
        };
    }

    return mokesciai;
}
