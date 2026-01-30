import express from "express";
import config from "../utils/config.js";
import { fixHtmlEntities } from "../utils/fixHtmlEntities.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";

const sutartisRouter = express.Router();

sutartisRouter.get("/sutartis/:id", async (req, res, next) => {
    const { id } = req.params;

    let purchase = await postgres
        .query(
            'SELECT * FROM sutartys WHERE "sutartiesUnikalusId" = $1 LIMIT 1',
            [parseInt(id)],
        )
        .then((result) => result.rows[0]);

    // 404
    if (!purchase) return next();

    // Tiekėjo subjekto patikslinimas
    const sutartysAtviriDuomenys = await postgres.query(
        `SELECT *
         FROM "sutartysAtviriDuomenys"
         WHERE "dokId" = $1
         LIMIT 1;`,
        [purchase.sutartiesUnikalusId],
    );

    if (sutartysAtviriDuomenys.rowCount > 0) {
        if (sutartysAtviriDuomenys.rows[0].tiekPavPatikslinimas) {
            purchase.tiekejasPatikslinimas =
                sutartysAtviriDuomenys.rows[0].tiekPavPatikslinimas;
        }
        if (sutartysAtviriDuomenys.rows[0].tiekSalis) {
            purchase.tiekejasSalis = sutartysAtviriDuomenys.rows[0].tiekSalis;
        }
    }

    const sutartysAtviriDuomenysImp = await postgres.query(
        `SELECT *
         FROM "sutartysAtviriDuomenysImp"
         WHERE "dokId" = $1
         LIMIT 1;`,
        [purchase.sutartiesUnikalusId],
    );

    if (sutartysAtviriDuomenysImp.rowCount > 0) {
        if (sutartysAtviriDuomenysImp.rows[0].tiekSbjPatikslinimas) {
            purchase.tiekejasPatikslinimas =
                sutartysAtviriDuomenysImp.rows[0].tiekSbjPatikslinimas;
        }
        if (sutartysAtviriDuomenysImp.rows[0].tiekSalis) {
            purchase.tiekejasSalis =
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
                purchase.sutartiesUnikalusId,
                purchase.perkanciosiosOrganizacijosKodas,
                purchase.tiekejoKodas,
                purchase.verte,
            ],
        )
        .then((result) => result.rows);

    if (similarContracts.length > 0) {
        purchase.panasiosSutartys = similarContracts;
    }

    let sabisSutartys = await postgres.query(
        `SELECT *
         FROM "sabisSutartys"
         WHERE "vpId" = $1;`,
        [purchase.sutartiesUnikalusId],
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

    purchase.sabisSutartys = sabisSutartys;

    // Failų būsena
    await Promise.all(
        purchase.dokumentai.map(async (failas) => {
            failas.dok_id = failas.url.match(/dok_id=(\d+)/)[1];
            failas.file_id = failas.url.match(/file_id=(\d+)/)[1];
            failas.proxyUrl = `https://failai.viespirkiai.org/${failas.dok_id}/${failas.file_id}`;

            const failoBusena = await postgres
                .query(
                    `SELECT
              "dokId",
              "fileId",
              ("parsiustas" > 0) AS parsiustas,
              ("nuskaitytas" IS NOT NULL AND "nuskaitytas" > 0) AS nuskaitytas
          FROM failai
          WHERE "dokId" = $1
            AND "fileId" = $2`,
                    [failas.dok_id, failas.file_id],
                )
                .then((result) => result.rows[0]);

            failas.parsiustas = failoBusena?.parsiustas || false;
            failas.nuskaitytas = failoBusena?.nuskaitytas || false;
        }),
    );

    purchase.sutartiesUnikalusID = purchase.sutartiesUnikalusId;
    delete purchase.sutartiesUnikalusId;

    purchase.cpvaProjektuSutartys = [];
    if (purchase.pirkimoNumeris) {
        let cpvaProjektaiRes = await postgres.query(
            `SELECT *
             FROM "cpvaProjektuSutartys"
             WHERE "pirkimoNrCvpis" = $1;`,
            [purchase.pirkimoNumeris],
        );
        purchase.cpvaProjektuSutartys = cpvaProjektaiRes.rows;
    }

    for (let projektoSutartis of purchase.cpvaProjektuSutartys) {
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

    // Pataisomi HTML entities
    purchase.pavadinimas = fixHtmlEntities(purchase.pavadinimas);
    purchase.perkanciojiOrganizacija = fixHtmlEntities(
        purchase.perkanciojiOrganizacija,
    );
    purchase.tiekejas = fixHtmlEntities(purchase.tiekejas);

    // Formatuojame datas
    // purchase = dataToLithuanianTime(purchase);

    const contractTypes = {
        TSP: "Tarptautinis arba supaprastintas pirkimas",
        MVP: "Mažos vertės pirkimas",
        ŽS: "Žodinė sutartis",
        MVPŽ: "Mažos vertės žodinis pirkimas",
        SPŽ: "Supaprastintos vertės žodinis pirkimas",
        PPS: "Pagrindinė pirkimo sutartis",
        VS: "Vidaus sandoris",
        SP: "Sutarties pakeitimas",
        PSĮ: "Pirkimas iš susijusios įmonės",
        "ILGALAIKĖ MVPŽ": "Ilgalaikė mažos vertės žodinė sutartis",
    };

    const tipo = (purchase.tipas || "").trim().toUpperCase();
    purchase.tipoPavadinimas = contractTypes[tipo] || tipo;

    // Jei prašoma JSON formato, grąžiname JSON
    if (req.path.endsWith(".json")) {
        const formattedJson = JSON.stringify(purchase, null, 2);
        res.setHeader("Content-Type", "application/json");
        return res.send(formattedJson);
    }

    if (req.path.endsWith(".png")) {
        return await serveOpenGraphImage(
            res,
            purchase.tipoPavadinimas,
            `${Number(purchase.faktineIvykdimoVerte || purchase.verte).toLocaleString("lt-LT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € &nbsp; ${purchase.pavadinimas}`,
            `Pirkėjas: ${purchase.perkanciojiOrganizacija}<br>
            Tiekėjas: ${purchase.tiekejas}`,
            `viespirkiai.org/pirkimas/${purchase.sutartiesUnikalusID}`,
        );
    }

    res.set("Cache-Control", "public, max-age=7200, s-maxage=7200");
    res.render("pirkimas", { purchase, customHead: config.customHead });
});

export default sutartisRouter;
