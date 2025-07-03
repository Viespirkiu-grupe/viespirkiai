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

	if (req.query.limit == "max") {
		limit = 10000;
	} else if (parseInt(req.query.limit) > 10000) {
		return res
			.status(400)
			.send("Limitas per didelis. Maksimalus limitas yra 10000.");
	} else if (parseInt(req.query.limit) > 0) {
		limit = parseInt(req.query.limit) || 50;
	}

	const skip = (page - 1) * limit;
	let results, total, engine;
	let values = {};
	let queryParams = "";

	if (req.query.search) {
		if (limit > 250) {
			return res
				.status(400)
				.send("Limitas per didelis. Maksimalus limitas su paieška yra 250.");
		}

		values.search = req.query.search;
		queryParams += `&search=${encodeURIComponent(req.query.search)}`;

		try {
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

			results = rows;
			total = response[0].total || 0;
		} catch (err) {
			console.error("MySQL query error:", err);
			return res.status(500).send("Server error");
		}

		engine = "Mysql";
		if (req.query.json) {
			return res.json(results);
		}

		const totalPages = Math.ceil(total / limit);

		results = arrayToLithuanianTime(results);

		let trukme = (performance.now() - startas) / 1000;
		let numberOfResults = `${total} rezultatai(-ai) per ${trukme.toFixed(
			2
		)}s <pre style="display: inline;">(${engine})</pre>`;

		res.render("juridiniai/index", {
			customHead: config.customHead,
			values,
			data: results,
			queryParams,
			numberOfResults,
			currentPage: page,
			pageCount: totalPages,
		});
	} else {
		res.render("juridiniai/index", {
			customHead: config.customHead,
			values: {},
		});
	}
});

export default juridiniaiRouter;
