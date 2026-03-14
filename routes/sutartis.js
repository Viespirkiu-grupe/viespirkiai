import express from "express";
import config from "../utils/config.js";
import { fixHtmlEntities } from "../utils/fixHtmlEntities.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { CONTRACT_TYPES } from "../modules/sutartys/contractTypes.js";
import { postgres } from "../postgres/postgres.js";

const sutartisRouter = express.Router();

sutartisRouter.get("/sutartis/:id", async (req, res, next) => {
    const { id } = req.params;

    // If id is not a number – return 404
    if (isNaN(parseInt(id))) {
        return next();
    }

    let sutartis = await postgres
        .query(
            'SELECT * FROM sutartys WHERE "sutartiesUnikalusId" = $1 LIMIT 1',
            [parseInt(id)],
        )
        .then((result) => result.rows[0]);

    // 404
    if (!sutartis) return next();

    // Tiekėjo subjekto patikslinimas
    const sutartysAtviriDuomenys = await postgres.query(
        `SELECT *
         FROM "sutartysAtviriDuomenys"
         WHERE "dokId" = $1
         LIMIT 1;`,
        [sutartis.sutartiesUnikalusId],
    );

    if (sutartysAtviriDuomenys.rowCount > 0) {
        if (sutartysAtviriDuomenys.rows[0].tiekPavPatikslinimas) {
            sutartis.tiekejasPatikslinimas =
                sutartysAtviriDuomenys.rows[0].tiekPavPatikslinimas;
        }
        if (sutartysAtviriDuomenys.rows[0].tiekSalis) {
            sutartis.tiekejasSalis = sutartysAtviriDuomenys.rows[0].tiekSalis;
        }
    }

    const sutartysAtviriDuomenysImp = await postgres.query(
        `SELECT *
         FROM "sutartysAtviriDuomenysImp"
         WHERE "dokId" = $1
         LIMIT 1;`,
        [sutartis.sutartiesUnikalusId],
    );

    if (sutartysAtviriDuomenysImp.rowCount > 0) {
        if (sutartysAtviriDuomenysImp.rows[0].tiekSbjPatikslinimas) {
            sutartis.tiekejasPatikslinimas =
                sutartysAtviriDuomenysImp.rows[0].tiekSbjPatikslinimas;
        }
        if (sutartysAtviriDuomenysImp.rows[0].tiekSalis) {
            sutartis.tiekejasSalis =
                sutartysAtviriDuomenysImp.rows[0].tiekSalis;
        }
    }

    // Panašios sutartys
    const similarContracts = await postgres
        .query(
            `SELECT *
        FROM sutartys
        WHERE "sutartiesUnikalusId" != $1
          AND "perkanciosiosOrganizacijosKodas" = $2
          AND "tiekejoKodas" = $3
          AND verte = $4
        ORDER BY "paskutinioRedagavimoData" DESC`,
            [
                sutartis.sutartiesUnikalusId,
                sutartis.perkanciosiosOrganizacijosKodas,
                sutartis.tiekejoKodas,
                sutartis.verte,
            ],
        )
        .then((result) => result.rows);

    if (similarContracts.length > 0) {
        sutartis.panasiosSutartys = similarContracts;
    }

    let sabisSutartys = await postgres.query(
        `SELECT *
         FROM "sabisSutartys"
         WHERE "vpId" = $1;`,
        [sutartis.sutartiesUnikalusId],
    );

    sabisSutartys = sabisSutartys.rows;

    await Promise.all(
        sabisSutartys.map(async (sabisSutartis) => {
            const result = await postgres.query(
                `SELECT *
                 FROM "sabisSutarciuSalys"
                 WHERE "sutartiesId" = $1;`,
                [sabisSutartis.sutartiesId],
            );
            sabisSutartis.salys = result.rows;
        }),
    );

    await Promise.all(
        sabisSutartys.map(async (sabisSutartis) => {
            const result = await postgres.query(
                `SELECT * FROM "sabisSaskaitos" WHERE "sutartiesUid" = $1;`,
                [sabisSutartis.sutartiesUid],
            );

            let saskaitos = result.rows;

            await Promise.all(
                saskaitos.map(async (saskaita) => {
                    const itemResult = await postgres.query(
                        `SELECT * FROM "sabisSaskaituSalys" WHERE "sfId" = $1;`,
                        [saskaita.sfId],
                    );
                    saskaita.salys = itemResult.rows;
                }),
            );

            sabisSutartis.saskaitos = saskaitos;
        }),
    );

    sutartis.sabisSutartys = sabisSutartys;

    // Failų būsena
    await Promise.all(
        sutartis.dokumentai.map(async (failas) => {
            const dokIdMatch = failas.url.match(/dok_id=(\d+)/);
            const fileIdMatch = failas.url.match(/file_id=(\d+)/);
            failas.dok_id = dokIdMatch ? dokIdMatch[1] : "";
            failas.file_id = fileIdMatch ? fileIdMatch[1] : "";
            failas.proxyUrl =
                failas.dok_id && failas.file_id
                    ? `https://eviesiejipirkimai.lt/download.php?dok_id=${failas.dok_id}&file_id=${failas.file_id}`
                    : "";

            const failoBusena = await postgres
                .query(
                    `SELECT
              "dokId",
              "fileId",
              ("parsiustas" > 0) AS parsiustas,
              ("nuskaitytas" IS NOT NULL AND "nuskaitytas" > 0) AS nuskaitytas,
              id
          FROM failai
          WHERE "dokId" = $1
            AND "fileId" = $2`,
                    [failas.dok_id, failas.file_id],
                )
                .then((result) => result.rows[0]);

            failas.parsiustas = failoBusena?.parsiustas || false;
            failas.nuskaitytas = failoBusena?.nuskaitytas || false;
            if (failoBusena?.parsiustas) {
                failas.id = failoBusena.id;
                failas.proxyUrl = `https://failai.viespirkiai.org/${failas.id}`;
            }
        }),
    );

    sutartis.sutartiesUnikalusID = sutartis.sutartiesUnikalusId;
    delete sutartis.sutartiesUnikalusId;

    sutartis.cpvaProjektuSutartys = [];
    if (sutartis.pirkimoNumeris) {
        let cpvaProjektaiRes = await postgres.query(
            `SELECT *
             FROM "cpvaProjektuSutartys"
             WHERE "pirkimoNrCvpis" = $1;`,
            [sutartis.pirkimoNumeris],
        );
        sutartis.cpvaProjektuSutartys = cpvaProjektaiRes.rows;
    }

    for (let projektoSutartis of sutartis.cpvaProjektuSutartys) {
        let projektasRes = await postgres.query(
            `SELECT *
             FROM "cpvaProjektuSarasas"
             WHERE "projektoNr" = $1;`,
            [projektoSutartis.projektoNr],
        );
        if (projektasRes.rows.length > 0) {
            projektoSutartis.projektas = projektasRes.rows[0];
        }
    }

    let cvppPirkimas = await postgres.query(
        `SELECT * FROM "cvppViesiejiPirkimai" WHERE "pirkimoNumeris" = $1`,
        [sutartis.pirkimoNumeris],
    );
    if (cvppPirkimas.rowCount > 0) {
        sutartis.cvppPirkimas = cvppPirkimas.rows[0];
    }

    let cvpisPirkimas = await postgres.query(
        `SELECT * FROM "viesiejiPirkimai" WHERE "pirkimoId" = $1`,
        [sutartis.pirkimoNumeris],
    );
    if (cvpisPirkimas.rowCount > 0) {
        sutartis.cvpisPirkimas = cvpisPirkimas.rows[0];
    }

    // Pataisomi HTML entities
    sutartis.pavadinimas = fixHtmlEntities(sutartis.pavadinimas);
    sutartis.perkanciojiOrganizacija = fixHtmlEntities(
        sutartis.perkanciojiOrganizacija,
    );
    sutartis.tiekejas = fixHtmlEntities(sutartis.tiekejas);

    const tipo = (sutartis.tipas || "").trim().toUpperCase();
    sutartis.tipoPavadinimas = CONTRACT_TYPES[tipo] || tipo;

    // Jei prašoma JSON formato, grąžiname JSON
    if (req.path.endsWith(".json")) {
        const formattedJson = JSON.stringify(sutartis, null, 2);
        res.setHeader("Content-Type", "application/json");
        return res.send(formattedJson);
    }

    if (req.path.endsWith(".png")) {
        return await serveOpenGraphImage(
            res,
            sutartis.tipoPavadinimas,
            `${Number(sutartis.faktineIvykdimoVerte || sutartis.verte).toLocaleString("lt-LT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € &nbsp; ${sutartis.pavadinimas}`,
            `Pirkėjas: ${sutartis.perkanciojiOrganizacija}<br>
            Tiekėjas: ${sutartis.tiekejas}`,
            `viespirkiai.org/sutartis/${sutartis.sutartiesUnikalusID}`,
        );
    }

    res.set("Cache-Control", "private, max-age=7200, s-maxage=7200");
    res.render("sutartys/sutartis", {
        sutartis,
        customHead: config.customHead,
        req,
    });
});

export default sutartisRouter;
