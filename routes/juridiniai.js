import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { mysql } from "../mysql/mysql.js";
import { arrayToLithuanianTime } from "../utils/time.js";

const juridiniaiRouter = express.Router();

juridiniaiRouter.get("/", cleanEmptyQueryParams, async (req, res) => {
	const startas = performance.now();

	const page = parseInt(req.query.page) || 1;
	let limit = 50;

	const MAX_LIMIT = 250;
	if (req.query.limit == "max") {
		limit = MAX_LIMIT;
	} else if (parseInt(req.query.limit) > MAX_LIMIT) {
		return res
			.status(400)
			.send(`Limitas per didelis. Maksimalus limitas yra ${MAX_LIMIT}.`);
	} else if (parseInt(req.query.limit) > 0) {
		limit = parseInt(req.query.limit) || limit;
	}

	const skip = (page - 1) * limit;
	if (req.query.search) {
		let values = {
			search: req.query.search,
		};

		let queryParams = `&search=${encodeURIComponent(req.query.search)}`;

		// Vienu metu gauname rezultatus ir jų skaičių
		const [[rows], [response]] = await Promise.all([
			mysql.query(
				`(
				SELECT * FROM jar WHERE adresas LIKE CONCAT('%', ?, '%')
			)
			UNION
			(
				SELECT * FROM jar WHERE pavadinimas LIKE CONCAT('%', ?, '%')
			)
			LIMIT ? OFFSET ?`,
				[req.query.search, req.query.search, limit, skip]
			),

			mysql.query(
				`SELECT COUNT(*) AS total FROM (
				SELECT jarKodas FROM jar WHERE adresas LIKE CONCAT('%', ?, '%')
				UNION
				SELECT jarKodas FROM jar WHERE pavadinimas LIKE CONCAT('%', ?, '%')
			) AS combined`,
				[req.query.search, req.query.search]
			),
		]);

		var results = rows;
		var total = response[0].total || 0;

		// Jei prašoma JSON
		if (req.query.json) {
			return res.json(results);
		}

		// Jei prašoma JSONL
		if (req.query.jsonl) {
			res.setHeader("Content-Type", "application/x-ndjson");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename=viespirkiai-${new Date().toISOString()}.jsonl`
			);

			results.forEach((item) => {
				res.write(JSON.stringify(item) + "\n");
			});
			return res.end();
		}

		// Jei prašoma CSV
		if (req.query.csv) {
			res.setHeader("Content-Type", "text/csv");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename=viespirkiai-${new Date().toISOString()}.csv`
			);
			const csvHeader = Object.keys(results[0]).join(",") + "\n";
			res.write(csvHeader);
			results.forEach((item) => {
				delete item.adresoId;
				const csvRow = Object.values(item)
					.map((value) => `"${value}"`)
					.join(",") + "\n";
				res.write(csvRow);
			});
			return res.end();
		}

		// Pakeičiame datų formatus
		results = arrayToLithuanianTime(results);

		// Paieškos užklausos informacija
		let trukme = ((performance.now() - startas) / 1000).toFixed(2) + "s";
		let rodomiRezultatai = results.length;
		if (rodomiRezultatai < total) {
			var numberOfResults = `Rodomi ${rodomiRezultatai} iš ${total} rezultatų <pre style="display: inline;">(${trukme}, Mysql)</pre>`;
		} else {
			var numberOfResults = `${total} rezultatas(-ai) <pre style="display: inline;">(${trukme}, Mysql)</pre>`;
		}

		let galimaEksportuoti = total > 0 && total <= MAX_LIMIT;

		res.render("juridiniai/index", {
			customHead: config.customHead,
			values,
			data: results,
			queryParams,
			numberOfResults,
			currentPage: page,
			pageCount: Math.ceil(total / limit),
			galimaEksportuoti,
		});
	} else {
		res.render("juridiniai/index", {
			customHead: config.customHead,
			values: {},
		});
	}
});

export default juridiniaiRouter;
