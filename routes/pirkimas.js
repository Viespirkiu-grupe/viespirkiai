import express from "express";
import { dataToLithuanianTime } from "../utils/time.js";
import { viespirkiai } from "../mongo/mongoDb.js";
import config from '../utils/config.js';
import { fixHtmlEntities } from "../utils/fixHtmlEntities.js";

const pirkimasRouter = express.Router();

pirkimasRouter.get("/:id", async (req, res) => {
	const { id } = req.params;

	let purchase = await viespirkiai.findOne({
		sutartiesUnikalusID: parseInt(id),
	});
	if (!purchase) return res.status(404).send("Not found");

	purchase.pavadinimas = fixHtmlEntities(purchase.pavadinimas);
	purchase.perkanciojiOrganizacija = fixHtmlEntities(purchase.perkanciojiOrganizacija);
	purchase.tiekejas = fixHtmlEntities(purchase.tiekejas);

	if (req.path.endsWith(".json")) {
		const formattedJson = JSON.stringify(purchase, null, 2);
		res.setHeader("Content-Type", "application/json");
		return res.send(formattedJson);
	}

	purchase = dataToLithuanianTime(purchase);

	res.render("pirkimas", { purchase, customHead: config.customHead });
});

export default pirkimasRouter;
