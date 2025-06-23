import express from "express";
import { viespirkiai } from "../database.js";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import { arrayToLithuanianTime } from "../utils/time.js";
import { buildTypesenseFilter, buildMongoFilter } from "../utils/filter.js";
import { searchDocuments } from "../typesense.js";
import config from '../utils/config.js';
import { fixHtmlEntities } from "../utils/fixHtmlEntities.js";


const indexRouter = express.Router();

let pirkimuSkaicius = await viespirkiai.estimatedDocumentCount();

indexRouter.get("/", cleanEmptyQueryParams, async (req, res) => {
	const startTime = performance.now();

	const page = parseInt(req.query.page) || 1;
	const limit = 50;
	const skip = (page - 1) * limit;

	let results, total, usedHiddenFields, queryParams, engine, values;
	if (req.query.search) {
		let filterBy;
		({ filterBy, values, queryParams, usedHiddenFields } = buildTypesenseFilter(
			req.query
		));

		queryParams += `&search=${encodeURIComponent(req.query.search)}`;

		({ results, total } = await searchDocuments(req.query.search || "*", {
			page: page,
			filterBy,
			sortBy: "paskutinioRedagavimoData:desc",
		}));

		engine = "Typesense";
	} else {
		let filter;
		({ filter, values, queryParams, usedHiddenFields } = buildMongoFilter(
			req.query
		));

		if (Object.keys(filter).length === 0) {
			total = pirkimuSkaicius;
		} else {
			total = await viespirkiai.countDocuments(filter);
		}

		results = await viespirkiai
			.find(filter)
			.sort({ paskutinioRedagavimoData: -1 })
			.skip(skip)
			.limit(limit)
			.toArray();

		engine = "MongoDB";
	}

	for(let i = 0; i < results.length; i++) {
		results[i].pavadinimas = fixHtmlEntities(results[i].pavadinimas);
		results[i].perkanciojiOrganizacija = fixHtmlEntities(results[i].perkanciojiOrganizacija);
		results[i].tiekejas = fixHtmlEntities(results[i].tiekejas);
	}

	values.search = req.query.search || "";

	const totalPages = Math.ceil(total / limit);

	results = arrayToLithuanianTime(results);

	let trukme = (performance.now() - startTime) / 1000;
	let numberOfResults = `${total} rezultatai(-ai) per ${trukme.toFixed(
		2
	)}s <pre style="display: inline;">(${engine})</pre>`;

	if(req.query.json){
		return res.json(results);
	}

	res.render("index", {
		data: results,
		values,
		usedHiddenFields,
		currentPage: page,
		pageCount: totalPages,
		numberOfResults,
		queryParams,
		customHead: config.customHead
	});
});

export default indexRouter;
