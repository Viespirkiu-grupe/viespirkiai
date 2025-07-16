import express from "express";
import { mysql } from "../mysql/mysql.js";
import { Readable } from "stream";
import mime from "mime";

const failasRouter = express.Router();

failasRouter.get("/:dokId/:fileId/download", async (req, res) => {
	let { dokId, fileId } = req.params;

	const [failasRezultatai] = await mysql.execute(
		"SELECT * FROM failai WHERE dokId = ? AND fileId = ?;",
		[dokId, fileId]
	);

	if (failasRezultatai.length === 0) {
		return res.status(404).send("Not found");
	}

	let failas = failasRezultatai[0];

	if (failas.parsiustas === 0) {
		return res.status(400).send("Failas dar neparsiųstas.");
	}

	let [deze] = await mysql.execute(
		"SELECT * FROM dezes WHERE pavadinimas = ? LIMIT 1",
		[failas.saugojama]
	);

	if (deze.length === 0) {
		return res.status(404).send("Dėžė nerasta.");
	}

	deze = deze[0];

	const fileUrl = `${deze.url}/file/${failas.md5}.${failas.extension}`;
	let failasBlob = await fetch(fileUrl, {
		headers: {
			"x-api-key": deze.apiKey,
		},
	});

	if (!failasBlob.ok) {
		return res.status(500).send("Nepavyko gauti failo.");
	}

	res.setHeader(
		"Content-Disposition",
		`inline; filename="${failas.pavadinimas}"`
	);

	res.setHeader(
		"Content-Disposition",
		`inline; filename="${failas.pavadinimas}"`
	);

	// Get mime type dynamically from extension or fallback
	const contentType =
		mime.getType(failas.extension) || "application/octet-stream";

	res.setHeader("Content-Type", contentType);
	res.setHeader("Content-Length", failas.dydis);

	const nodeStream = Readable.fromWeb(failasBlob.body);
	nodeStream.pipe(res);
});

export default failasRouter;
