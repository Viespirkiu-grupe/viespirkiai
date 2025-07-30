import express from "express";
import { dataToLithuanianTime } from "../utils/time.js";
import { viespirkiai } from "../mongo/mongoDb.js";
import config from '../utils/config.js';
import { fixHtmlEntities } from "../utils/fixHtmlEntities.js";

const pirkimasRouter = express.Router();

pirkimasRouter.get("/:id", async (req, res, next) => {
	const { id } = req.params;

	// Randamas pirkimas pagal unikalų ID
	let purchase = await viespirkiai.findOne({
		sutartiesUnikalusID: parseInt(id),
	});

	// 404
	if (!purchase) return next();

	// Pataisomi HTML entities
	purchase.pavadinimas = fixHtmlEntities(purchase.pavadinimas);
	purchase.perkanciojiOrganizacija = fixHtmlEntities(purchase.perkanciojiOrganizacija);
	purchase.tiekejas = fixHtmlEntities(purchase.tiekejas);

	// Pridedame dokumentų adresus
	if(purchase.dokumentai && purchase.dokumentai.length > 0) {
		purchase.dokumentai = purchase.dokumentai.map(doc => {
			doc.dok_id = doc.url.match(/dok_id=(\d+)/)[1];
			doc.file_id = doc.url.match(/file_id=(\d+)/)[1];
			doc.proxyUrl = `https://failai.viespirkiai.top/${doc.dok_id}/${doc.file_id}`;
			return doc;
		});
	}

	// Formatuojame datas
	purchase = dataToLithuanianTime(purchase);

	// Jei prašoma JSON formato, grąžiname JSON
	if (req.path.endsWith(".json")) {
		const formattedJson = JSON.stringify(purchase, null, 2);
		res.setHeader("Content-Type", "application/json");
		return res.send(formattedJson);
	}

	res.set('Cache-Control', 'public, max-age=7200, s-maxage=7200');
	res.render("pirkimas", { purchase, customHead: config.customHead });
});

export default pirkimasRouter;
