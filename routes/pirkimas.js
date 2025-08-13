import express from "express";
import { dataToLithuanianTime } from "../utils/time.js";
import { viespirkiai } from "../mongo/mongoDb.js";
import config from "../utils/config.js";
import { fixHtmlEntities } from "../utils/fixHtmlEntities.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const pirkimasRouter = express.Router();

pirkimasRouter.get("/pirkimas/:id", async (req, res, next) => {
    const { id } = req.params;

    // Randamas pirkimas pagal unikalų ID
    let purchase = await viespirkiai.findOne({
        sutartiesUnikalusID: parseInt(id),
    });

    // 404
    if (!purchase) return next();

    // Pataisomi HTML entities
    purchase.pavadinimas = fixHtmlEntities(purchase.pavadinimas);
    purchase.perkanciojiOrganizacija = fixHtmlEntities(
        purchase.perkanciojiOrganizacija,
    );
    purchase.tiekejas = fixHtmlEntities(purchase.tiekejas);

    // Pridedame dokumentų adresus
    if (purchase.dokumentai && purchase.dokumentai.length > 0) {
        purchase.dokumentai = purchase.dokumentai.map((doc) => {
            doc.dok_id = doc.url.match(/dok_id=(\d+)/)[1];
            doc.file_id = doc.url.match(/file_id=(\d+)/)[1];
            doc.proxyUrl = `https://failai.viespirkiai.top/${doc.dok_id}/${doc.file_id}`;
            return doc;
        });
    }

    // Formatuojame datas
    purchase = dataToLithuanianTime(purchase);

    const contractTypes = {
        TSP: "Tarptautinis, supaprastintas pirkimas",
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
            `viespirkiai.top/pirkimas/${purchase.sutartiesUnikalusID}`,
        );
    }

    res.set("Cache-Control", "public, max-age=7200, s-maxage=7200");
    res.render("pirkimas", { purchase, customHead: config.customHead });
});

export default pirkimasRouter;
