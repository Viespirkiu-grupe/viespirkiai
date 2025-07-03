import express from "express";
import { mysql } from "../mysql/mysql.js";
import config from "../config.js";

const eksportaiRouter = express.Router();

eksportaiRouter.get("/:id", async (req, res) => {
	// It might end with .torrent, then give the torrent file
	let { id } = req.params;
	let torrent = false;
	if (id.endsWith(".torrent")) {
		torrent = true;
		id = id.slice(0, -8);
	}

	let [row] = await mysql.execute("SELECT * FROM eksportai WHERE id = ?;", [id]);

	if (row.length === 0) {
		return res.status(404).send("Not found");
	}

	row = row[0];

	if (torrent) {
		res.setHeader("Content-Type", "application/x-bittorrent");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${row.pavadinimas}.torrent"`
		);
		res.send(row.torrent);
	} else {
		res.render("eksportas.ejs", {
			eksportas: row,
			customHead: config.customHead
		});
	}
});

export default eksportaiRouter;
