import express from "express";
import { viespirkiai } from "../mongo/mongoDb.js";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import { arrayToLithuanianTime } from "../utils/time.js";
import { buildTypesenseFilter, buildMongoFilter } from "../utils/filter.js";
import { searchDocuments } from "../typesense/typesense.js";
import config from "../utils/config.js";
import { fixHtmlEntities } from "../utils/fixHtmlEntities.js";

const indexRouter = express.Router();

let pirkimuSkaicius = await viespirkiai.estimatedDocumentCount();

indexRouter.get("/", cleanEmptyQueryParams, async (req, res) => {
	const startas = performance.now();

	const page = parseInt(req.query.page) || 1;
	let limit = 50;

	if(req.query.limit == "max"){
		limit = 10000;
	}else if(parseInt(req.query.limit) > 10000){
		return res
			.status(400)
			.send("Limitas per didelis. Maksimalus limitas yra 10000.");

	}else if(parseInt(req.query.limit) > 0){
		limit = parseInt(req.query.limit) || 50;
	}

	const skip = (page - 1) * limit;

	let results, total, usedHiddenFields, queryParams, engine, values;
	if (req.query.search) {
		if(limit > 250){
			return res
				.status(400)
				.send("Limitas per didelis. Maksimalus limitas su paieška yra 250.");
		}
		let filterBy;
		({ filterBy, values, queryParams, usedHiddenFields } = buildTypesenseFilter(
			req.query
		));

		queryParams += `&search=${encodeURIComponent(req.query.search)}`;

		({ results, total } = await searchDocuments(req.query.search || "*", {
			page: page,
			filterBy,
			sortBy: "paskutinioRedagavimoData:desc",
			limit,
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

	for (let i = 0; i < results.length; i++) {
		results[i].pavadinimas = fixHtmlEntities(results[i].pavadinimas);
		results[i].perkanciojiOrganizacija = fixHtmlEntities(
			results[i].perkanciojiOrganizacija
		);
		results[i].tiekejas = fixHtmlEntities(results[i].tiekejas);
	}

	values.search = req.query.search || "";

	const totalPages = Math.ceil(total / limit);

	results = arrayToLithuanianTime(results);

	let trukme = (performance.now() - startas) / 1000;
	let numberOfResults = `${total} rezultatai(-ai) per ${trukme.toFixed(
		2
	)}s <pre style="display: inline;">(${engine})</pre>`;

	if (req.query.json) {
		return res.json(results);
	}

	if (req.query.csv) {
		res.setHeader("Content-Type", "text/csv");
		res.setHeader(
			"Content-Disposition",
			"attachment; filename=viespirkiai.csv"
		);
		res.setHeader("Content-Transfer-Encoding", "binary");

		const escapeCSV = (value) => `"${String(value).replace(/"/g, '""')}"`;

		const formatDate = (value) => {
			if (!value) return "";
			const date = new Date(value);
			return isNaN(date) ? "" : date.toISOString().split("T")[0];
		};

		const header =
			[
				"Tipas",
				"Pavadinimas",
				"Vertė",
				"Pirkėjo pavadinimas",
				"Pirkėjo kodas",
				"Tiekėjo pavadinimas",
				"Tiekėjo kodas",
				"Sudarymo data",
				"Redagavimo data",
			].join(",") + "\n";

		// Write header
		res.write(header);

		// Stream rows
		for (const row of results) {
			const values = [
				row.tipas,
				row.pavadinimas,
				row.verte,
				row.perkanciojiOrganizacija,
				row.perkanciosiosOrganizacijosKodas,
				row.tiekejas,
				row.tiekejoKodas,
				formatDate(row.sudarymoData),
				formatDate(row.paskutinioRedagavimoData),
			];
			const csvLine = values.map(escapeCSV).join(",") + "\n";
			res.write(csvLine);
		}

		res.end();
		return; 
	}

	res.render("index", {
		data: results,
		values,
		usedHiddenFields,
		currentPage: page,
		pageCount: totalPages,
		numberOfResults,
		queryParams,
		customHead: config.customHead,
	});
});

export default indexRouter;
