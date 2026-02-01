import { postgres } from "../../postgres/postgres.js";

export async function gautiVmiDuomenis(jarKodas) {
    const { rows: mokesciaiRezultatai } = await postgres.query(
        `SELECT * FROM mokesciai WHERE "jarKodas" = $1 ORDER BY "metai" ASC, "menuo" ASC;`,
        [jarKodas],
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
