import { z } from "zod";
import { postgres } from "../../../postgres/postgres.js";
import { fixHtmlEntities } from "../../../utils/fixHtmlEntities.js";
import { CONTRACT_TYPES } from "../../sutartys/contractTypes.js";

export const name = "get_sutartis";
export const description =
    "Grąžina išsamią informaciją apie vieną viešojo pirkimo sutartį pagal jos unikalų ID. Apima pirkėjo, tiekėjo, vertės, terminų, BVPŽ kodų, dokumentų, SABIS sutarčių ir ES projektų duomenis.";

export const schema = {
    id: z.number().int().positive().describe("Sutarties unikalus ID"),
};

export async function handler({ id }) {
    let sutartis = await postgres
        .query(
            'SELECT * FROM sutartys WHERE "sutartiesUnikalusId" = $1 LIMIT 1',
            [id],
        )
        .then((r) => r.rows[0]);

    if (!sutartis) {
        return {
            content: [{ type: "text", text: `Sutartis su ID ${id} nerasta.` }],
            isError: true,
        };
    }

    // Tiekėjo patikslinimas
    const atviri = await postgres.query(
        `SELECT * FROM "sutartysAtviriDuomenys" WHERE "dokId" = $1 LIMIT 1`,
        [id],
    );
    if (atviri.rowCount > 0) {
        if (atviri.rows[0].tiekPavPatikslinimas)
            sutartis.tiekejasPatikslinimas =
                atviri.rows[0].tiekPavPatikslinimas;
        if (atviri.rows[0].tiekSalis)
            sutartis.tiekejasSalis = atviri.rows[0].tiekSalis;
    }

    const atviriImp = await postgres.query(
        `SELECT * FROM "sutartysAtviriDuomenysImp" WHERE "dokId" = $1 LIMIT 1`,
        [id],
    );
    if (atviriImp.rowCount > 0) {
        if (atviriImp.rows[0].tiekSbjPatikslinimas)
            sutartis.tiekejasPatikslinimas =
                atviriImp.rows[0].tiekSbjPatikslinimas;
        if (atviriImp.rows[0].tiekSalis)
            sutartis.tiekejasSalis = atviriImp.rows[0].tiekSalis;
    }

    // Panašios sutartys
    const panasios = await postgres.query(
        `SELECT "sutartiesUnikalusId", pavadinimas, verte, "faktineIvykdimoVerte", "sudarymoData", tipas
         FROM sutartys
         WHERE "sutartiesUnikalusId" != $1
           AND "perkanciosiosOrganizacijosKodas" = $2
           AND "tiekejoKodas" = $3
           AND verte = $4
         ORDER BY "paskutinioRedagavimoData" DESC`,
        [
            id,
            sutartis.perkanciosiosOrganizacijosKodas,
            sutartis.tiekejoKodas,
            sutartis.verte,
        ],
    );
    if (panasios.rows.length > 0) sutartis.panasiosSutartys = panasios.rows;

    // SABIS
    const sabisRes = await postgres.query(
        `SELECT * FROM "sabisSutartys" WHERE "vpId" = $1`,
        [id],
    );
    sutartis.sabisSutartys = sabisRes.rows;

    // ES projektai
    sutartis.cpvaProjektuSutartys = [];
    if (sutartis.pirkimoNumeris) {
        const cpva = await postgres.query(
            `SELECT * FROM "cpvaProjektuSutartys" WHERE "pirkimoNrCvpis" = $1`,
            [sutartis.pirkimoNumeris],
        );
        sutartis.cpvaProjektuSutartys = cpva.rows;
    }

    // Pataisomi HTML entities
    sutartis.pavadinimas = fixHtmlEntities(sutartis.pavadinimas);
    sutartis.perkanciojiOrganizacija = fixHtmlEntities(
        sutartis.perkanciojiOrganizacija,
    );
    sutartis.tiekejas = fixHtmlEntities(sutartis.tiekejas);

    const tipo = (sutartis.tipas || "").trim().toUpperCase();
    sutartis.tipoPavadinimas = CONTRACT_TYPES[tipo] || tipo;

    sutartis.sutartiesUnikalusID = sutartis.sutartiesUnikalusId;
    delete sutartis.sutartiesUnikalusId;

    return {
        content: [{ type: "text", text: JSON.stringify(sutartis, null, 2) }],
    };
}
