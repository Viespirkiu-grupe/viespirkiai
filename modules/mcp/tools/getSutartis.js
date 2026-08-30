import { z } from "zod";
import { postgres } from "../../../postgres/postgres.js";
import { fixHtmlEntities } from "../../../utils/fixHtmlEntities.js";
import { CONTRACT_TYPES } from "../../sutartys/contractTypes.js";
import {
    panasiosSutartysTrumpai,
    sutartisPagalId,
} from "../../sutartys/vpmSutartisRow.js";
import { loadCpvaProjektai } from "../../cpva/loadProjektai.js";

export const name = "get_sutartis";
export const description =
    "Grąžina išsamią informaciją apie vieną viešojo pirkimo sutartį pagal jos unikalų ID. Apima pirkėjo, tiekėjo, vertės, terminų, BVPŽ kodų, dokumentų, SABIS sutarčių ir ES projektų duomenis. Sumos - eurais.";
export const schema = {
    id: z.number().int().positive().describe("Sutarties unikalus ID"),
};

export async function handler({ id }) {
    let sutartis = await postgres
        .query(sutartisPagalId([id]))
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
        panasiosSutartysTrumpai([
            id,
            sutartis.perkanciosiosOrganizacijosKodas,
            sutartis.tiekejoKodas,
            sutartis.verte,
        ]),
    );
    if (panasios.rows.length > 0) sutartis.panasiosSutartys = panasios.rows;

    // Dokumentų būsena
    if (Array.isArray(sutartis.dokumentai)) {
        await Promise.all(
            sutartis.dokumentai.map(async (failas) => {
                const dokIdMatch = failas.url?.match(/dok_id=(\d+)/);
                const fileIdMatch = failas.url?.match(/file_id=(\d+)/);
                failas.dok_id = dokIdMatch ? dokIdMatch[1] : "";
                failas.file_id = fileIdMatch ? fileIdMatch[1] : "";
                failas.proxyUrl =
                    failas.dok_id && failas.file_id
                        ? `https://eviesiejipirkimai.lt/download.php?dok_id=${failas.dok_id}&file_id=${failas.file_id}`
                        : "";

                const failoBusena = await postgres
                    .query(
                        `SELECT f.id,
                                (f."downloadStatus" > 0) AS parsiustas,
                                (d.version IS NOT NULL AND d.version > 0) AS nuskaitytas
                         FROM public.files f
                         JOIN public."filesSourceTitles" st ON st.id = f."sourceTitleId"
                         LEFT JOIN public."filesDataExtraction" d ON d.id = f.id
                         WHERE st.title = 'sutartys'
                           AND f."sourceId0" = $1::text AND f."sourceId1" = $2::text`,
                        [String(failas.dok_id), String(failas.file_id)],
                    )
                    .then((r) => r.rows[0]);

                failas.parsiustas = failoBusena?.parsiustas || false;
                failas.nuskaitytas = failoBusena?.nuskaitytas || false;
                if (failoBusena?.parsiustas) {
                    failas.id = failoBusena.id;
                    failas.proxyUrl = `https://failai.viespirkiai.org/${failas.id}`;
                }
            }),
        );
    }

    // SABIS sutartys su šalimis ir sąskaitomis
    const sabisRes = await postgres.query(
        `SELECT * FROM "sabisSutartys" WHERE "vpId" = $1`,
        [id],
    );
    sutartis.sabisSutartys = sabisRes.rows;

    await Promise.all(
        sutartis.sabisSutartys.map(async (sabisSutartis) => {
            const salysRes = await postgres.query(
                `SELECT * FROM "sabisSutarciuSalys" WHERE "sutartiesId" = $1`,
                [sabisSutartis.sutartiesId],
            );
            sabisSutartis.salys = salysRes.rows;

            const sąskaitosRes = await postgres.query(
                `SELECT * FROM "sabisSaskaitos" WHERE "sutartiesUid" = $1`,
                [sabisSutartis.sutartiesUid],
            );
            const saskaitos = sąskaitosRes.rows;

            await Promise.all(
                saskaitos.map(async (saskaita) => {
                    const itemRes = await postgres.query(
                        `SELECT ss.*, t.tipas, v."veiklosVieta"
                         FROM "sabisSaskaituSalys" ss
                         LEFT JOIN "sabisSaskaituSalysTipai" t ON t.id = ss."tipasId"
                         LEFT JOIN "sabisSaskaituSalysVeiklosVieta" v ON v.id = ss."veiklosVietaId"
                         WHERE ss."sfId" = $1`,
                        [saskaita.sfId],
                    );
                    saskaita.salys = itemRes.rows;
                }),
            );

            sabisSutartis.saskaitos = saskaitos;
        }),
    );

    // ES projektai su pilnu projekto objektu
    sutartis.cpvaProjektuSutartys = await loadCpvaProjektai(sutartis);

    // CVPP ir CVPIS pirkimai
    const cvppRes = await postgres.query(
        `SELECT * FROM cvpp."archyvoSkelbimai" WHERE "pirkimoNumeris" = $1`,
        [sutartis.pirkimoNumeris],
    );
    if (cvppRes.rowCount > 0) sutartis.cvppPirkimas = cvppRes.rows[0];

    const cvpisRes = await postgres.query(
        `SELECT * FROM "eppsViesiejiPirkimai"."pirkimai" WHERE "pirkimoId" = $1`,
        [sutartis.pirkimoNumeris],
    );
    if (cvpisRes.rowCount > 0) sutartis.cvpisPirkimas = cvpisRes.rows[0];

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
