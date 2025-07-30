import express from "express";
import { mysql } from "../mysql/mysql.js";
import { Readable } from "stream";
import mime from "mime";

const failasRouter = express.Router();

failasRouter.get("/:dokId/:fileId/download", async (req, res, next) => {
	let { dokId, fileId } = req.params;

	// Randame failą
	const [failasRezultatai] = await mysql.execute(
		"SELECT * FROM failai WHERE dokId = ? AND fileId = ?;",
		[dokId, fileId]
	);

	// 404
	if (failasRezultatai.length === 0) {
		return next();
	}

	let failas = failasRezultatai[0];

	// Patikriname, ar failas yra parsiųstas
	if (failas.parsiustas === 0) {
		return res.status(400).send("Failas dar neparsiųstas.");
	}

	// Randame dėžę, kurioje saugomas failas
	let [deze] = await mysql.execute(
		"SELECT * FROM dezes WHERE pavadinimas = ? LIMIT 1",
		[failas.saugojama]
	);

	if (deze.length === 0) {
		return res.status(404).send("Dėžė nerasta.");
	}

	deze = deze[0];

	// Parsiunčiame failą
	const fileUrl = `${deze.url}/file/${failas.md5}.${failas.extension}`;
	let failasBlob = await fetch(fileUrl, {
		headers: {
			"x-api-key": deze.apiKey,
		},
	});

	if (!failasBlob.ok) {
		return res.status(500).send("Nepavyko gauti failo.");
	}

	// Nustatome failo pavadinimą, prašome atvaizduoti naršyklėje
	res.setHeader(
		"Content-Disposition",
		`inline; filename*=UTF-8''${encodeURIComponent(failas.pavadinimas)}`
	);

	// Nustatome failo tipą
	const contentType =
		mime.getType(failas.extension) || "application/octet-stream";

	res.setHeader("Content-Type", contentType);
	res.setHeader("Content-Length", failas.dydis);

	// Persiunčiame failą
	const nodeStream = Readable.fromWeb(failasBlob.body);
	nodeStream.pipe(res);
});

export default failasRouter;
