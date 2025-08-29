import express from "express";
import { postgres } from "../postgres/postgres.js";
import config from "../config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const eksportaiRouter = express.Router();

eksportaiRouter.get("/eksportai/:id", async (req, res, next) => {
    let { id } = req.params;

    // Ar tai yra .torrent failas?
    let torrent = false;
    if (id.endsWith(".torrent")) {
        torrent = true;
        id = id.slice(0, -8);
    }
    if (id.endsWith(".png")) {
        id = id.slice(0, -4);
    }

    // Gauname eksportą pagal ID
    const { rows } = await postgres.query(
        "SELECT * FROM eksportai WHERE id = $1;",
        [id],
    );

    // 404
    if (rows.length === 0) {
        return next();
    }

    let row = rows[0];

    // Siunčiame .torrent failą
    if (torrent) {
        res.setHeader("Content-Type", "application/x-bittorrent");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${encodeURIComponent(row.pavadinimas)}.torrent"`,
        );
        res.send(row.torrent);
        return;
    }
    if (req.path.endsWith(".png")) {
        return await serveOpenGraphImage(
            res,
            "Duomenų eksportas",
            row.pavadinimas,
            "Galite parsisiųsti šį duomenų eksportą",
            `viespirkiai.top/eksportas/${row.id}`,
        );
    }

    // Atvaizduojame informaciją
    res.render("eksportas.ejs", {
        eksportas: row,
        customHead: config.customHead,
    });
});

export default eksportaiRouter;
