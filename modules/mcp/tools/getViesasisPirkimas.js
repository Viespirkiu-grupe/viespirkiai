import { z } from "zod";
import { postgres } from "../../../postgres/postgres.js";
import { aptvarkytiRezultata } from "../../viesiejiPirkimai/searchViesiejiPirkimai.js";

export const name = "get_viesasis_pirkimas";
export const description = `Grąžina išsamią informaciją apie vieną viešąjį pirkimą pagal pirkimo ID. Apima turinį, failus (sieti tik pagal versijos md5 arba verijos key "id", get_failas), vykdytojo duomenis. Po to norint atidaryti failą jau turi md5 / failo numerinį id, todėl naudok get_file! (ne search_files!)`;

export const schema = {
    pirkimoId: z.string().describe("Viešojo pirkimo ID"),
};

export async function handler({ pirkimoId }) {
    const { rows } = await postgres.query(
        `SELECT p.*, v.pavadinimas AS "vykdytojoPavadinimas", v."jarKodas"
         FROM public."viesiejiPirkimai" p
         LEFT JOIN public."viesiejiPirkimaiVykdytojai" v ON v.id = p."pirkimoVykdytojasId"
         WHERE p."pirkimoId" = $1`,
        [pirkimoId],
    );

    if (!rows[0]) {
        return {
            content: [
                { type: "text", text: `Pirkimas su ID ${pirkimoId} nerastas.` },
            ],
            isError: true,
        };
    }

    rows[0] = aptvarkytiRezultata(rows[0]);

    const failai = rows[0].turinys?.failai ?? [];
    const saltinioIds = failai.flatMap((failas) =>
        (failas.versijos ?? []).map(
            (v) => `${pirkimoId}/${failas.dokumentasId}/${v.versionId}`,
        ),
    );
    if (saltinioIds.length) {
        const { rows: failaiRows } = await postgres.query(
            `SELECT * FROM public."failai"
             WHERE saltinis = 'cvpIs' AND "saltinioId" = ANY($1)`,
            [saltinioIds],
        );
        const lokalusFailai = Object.fromEntries(
            failaiRows.map((f) => [f.saltinioId, f]),
        );
        for (const failas of failai) {
            for (const versija of failas.versijos ?? []) {
                const saltinioId = `${pirkimoId}/${failas.dokumentasId}/${versija.versionId}`;
                const lokalus = lokalusFailai[saltinioId];
                if (lokalus) {
                    const {
                        id,
                        filename,
                        extension,
                        parsiustas,
                        nuskaitytas,
                        zodziuSkaicius,
                        puslapiuSkaicius,
                        dydis,
                        md5,
                    } = lokalus;
                    Object.assign(versija, {
                        id,
                        filename,
                        extension,
                        parsiustas,
                        nuskaitytas,
                        zodziuSkaicius,
                        puslapiuSkaicius,
                        dydis,
                        md5,
                    });
                }
            }
        }
    }

    if (rows[0].turinys?.failai) {
        rows[0].turinys.failai = rows[0].turinys.failai.flatMap(
            ({ versijos, papildymoId, dokumentasId, ...failas }) =>
                versijos?.map(({ versionId, ...versija }) => ({
                    ...failas,
                    ...versija,
                })) ?? [failas],
        );
    }

    console.log(rows[0].turinys?.failai);

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(rows[0], null, 2),
            },
        ],
    };
}
