import { z } from "zod";
import { postgres } from "../../../postgres/postgres.js";
import { aptvarkytiRezultata } from "../../viesiejiPirkimai/searchViesiejiPirkimai.js";
import { assembleTurinys } from "../../viesiejiPirkimai/assembleTurinys.js";
import { prisegtiLokaliusFailus } from "../../viesiejiPirkimai/prisegtiLokaliusFailus.js";

export const name = "get_viesasis_pirkimas";
export const description = `Grąžina išsamią informaciją apie vieną viešąjį pirkimą pagal pirkimo ID. Apima turinį, failus (sieti tik pagal versijos md5 arba versijos key "id"), vykdytojo duomenis. Gavus failo md5 arba numerinį id — naudok get_failas (ne search_dokumentai!). Sumos - eurais.
Dalyviai ir pasiūlymų kainos (tik nauja CVP IS, t.y. kai pirkimas turi PPA failą): šie duomenys struktūrizuotai pasiekiami per execute_query, NE per get_failas_tekstas (PPA yra .xlsx, todėl teksto/OCR puslapiai tušti). Įėjimo taškas — xlsxPPAataskaitos (jungtys: "failasId"→failai.id, "pirkimoNumeris"→pirkimo numeris). Iš xlsxPPAataskaitos.id → "ataskaitaId" pasiekiamos: xlsxPPAdalyviai (dalyviai su kodais), xlsxPPAatmestiPasiulymai (atmesti pasiūlymai su kainomis), xlsxPPApasiulymuEile (pasiūlymų eilė su kainomis), xlsxPPAsutartys (sutarčių sumos ir tiekėjai). Ataskaitos enumų "...Id" laukai jungiami su atitinkamomis xlsxPPA žodynų lentelėmis per jų id; v_dalyviai pirkimo būdą jau grąžina tekstu. Tikslius stulpelius žiūrėk per get_schema(table). Seni pirkimai (CVPP) PPA neturi — dalyvių duomenys ten nepasiekiami.`;

export const schema = {
    pirkimoId: z.string().describe("Viešojo pirkimo ID"),
};

export async function handler({ pirkimoId }) {
    const { rows } = await postgres.query(
        `SELECT p.*, a."turinioNuskaitymoData", a."turinioNuskaitymas",
                v.pavadinimas AS "vykdytojoPavadinimas", v."jarKodas"
         FROM public."viesiejiPirkimai" p
         LEFT JOIN public."viesiejiPirkimaiAtnaujinimai" a ON a."pirkimoId" = p."pirkimoId"
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
    rows[0].turinys = await assembleTurinys(pirkimoId);

    await prisegtiLokaliusFailus(pirkimoId, rows[0].turinys?.failai ?? []);

    if (rows[0].turinys?.failai) {
        rows[0].turinys.failai = rows[0].turinys.failai.flatMap(
            ({ versijos, papildymoId, dokumentasId, ...failas }) =>
                versijos?.map(({ versionId, ...versija }) => ({
                    ...failas,
                    ...versija,
                })) ?? [failas],
        );
    }

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(rows[0], null, 2),
            },
        ],
    };
}
