import { postgres } from "../../postgres/postgres.js";

/**
 * Ryšys su juridiniu asmeniu eina TIK per `jarId` (= "rcJar"."spintaAsmenys"._id). Buvęs
 * `mokesciai."jarKodas"` buvo `id` dublikatas ir su JAR kodais nesutapdavo, tad
 * paieška pagal jį visada grąžindavo tuščią rezultatą (žr. vmiSchema.sql).
 *
 * @param {string} jarKodas – naudojamas tik atsakymo laukui užpildyti
 * @param {string | null | undefined} jarId
 */
export async function gautiVmiDuomenis(jarKodas, jarId = null) {
    if (!jarId) return undefined;

    const { rows: mokesciaiRezultatai } = await postgres.query(
        `SELECT DISTINCT ON (m."metai", m."menuo")
                m."metai", m."menuo", m."suma", m."duomenuData",
                p."pavadinimas", f."pavadinimas" AS "formosPavadinimas"
         FROM "vmi"."mokesciai" m
         JOIN      "vmi"."pavadinimai" p ON p."id" = m."pavadinimoId"
         LEFT JOIN "vmi"."formos" f      ON f."id" = m."formosId"
         WHERE m."jarId" = $1::uuid
         ORDER BY m."metai" ASC, m."menuo" ASC, m."duomenuData" DESC;`,
        [jarId],
    );

    let mokesciai;

    if (mokesciaiRezultatai.length > 0) {
        const naujausias = mokesciaiRezultatai.at(-1);

        const naudojamiNaujausi = [
            "pavadinimas",
            "formosPavadinimas",
            "suma",
        ];

        mokesciai = {
            ...Object.fromEntries(
                naudojamiNaujausi.map((key) => [key, naujausias[key]]),
            ),
            jarKodas,
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
