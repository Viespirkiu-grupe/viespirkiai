import { z } from "zod";
import { postgres } from "../../../postgres/postgres.js";
import { aptvarkytiRezultata } from "../../viesiejiPirkimai/searchViesiejiPirkimai.js";

export const name = "get_viesasis_pirkimas";
export const description = `Grąžina išsamią informaciją apie vieną viešąjį pirkimą pagal pirkimo ID. Apima turinį, failus (sieti tik pagal versijos md5 arba verijos key "id", get_failas), vykdytojo duomenis.`;

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

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(aptvarkytiRezultata(rows[0]), null, 2),
            },
        ],
    };
}
