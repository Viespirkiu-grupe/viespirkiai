import express from "express";
import { postgres } from "../postgres/postgres.js";
import { Readable } from "stream";
import mime from "mime";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const failasRouter = express.Router();

let statistika = {
    dydziai: {},
    kiekiai: {},
};

async function atnaujintiStatistika() {
    const [visiRes, parsiustiRes, klaidaRes, dydisRes] = await Promise.all([
        postgres.query("SELECT COUNT(*) AS total FROM failai;"),
        postgres.query(
            "SELECT COUNT(*) AS total FROM failai WHERE parsiustas = 1;",
        ),
        postgres.query(
            "SELECT COUNT(*) AS total FROM failai WHERE parsiustas = -1;",
        ),
        postgres.query(
            "SELECT SUM(dydis) AS total FROM failai WHERE parsiustas = 1;",
        ),
    ]);

    // PostgreSQL returns rows as .rows array
    const visiKiekis = parseInt(visiRes.rows[0].total, 10);
    const parsiustiKiekis = parseInt(parsiustiRes.rows[0].total, 10);
    const klaidaKiekis = parseInt(klaidaRes.rows[0].total, 10);
    const neparsiustiKiekis = visiKiekis - parsiustiKiekis - klaidaKiekis;

    const parsiustiDydis = parseFloat(dydisRes.rows[0].total) || 0;
    const vidutinisDydis =
        parsiustiKiekis > 0 ? parsiustiDydis / parsiustiKiekis : 0;
    const visuDydis = vidutinisDydis * visiKiekis;
    const neparsiustiDydis = visuDydis - parsiustiDydis;
    const klaidaDydis = vidutinisDydis * klaidaKiekis;

    statistika.kiekiai = {
        visi: visiKiekis,
        parsiusti: parsiustiKiekis,
        klaida: klaidaKiekis,
        neparsiusti: neparsiustiKiekis,
    };

    statistika.dydziai = {
        visi: parseFloat(visuDydis.toFixed(2)),
        parsiusti: parseFloat(parsiustiDydis.toFixed(2)),
        klaida: parseFloat(klaidaDydis.toFixed(2)),
        neparsiusti: parseFloat(neparsiustiDydis.toFixed(2)),
    };

    statistika.atnaujinta = new Date();
}

setInterval(atnaujintiStatistika, 1000 * 60 * 5); // kas 5 min.
atnaujintiStatistika(); // paleidimas iš karto

failasRouter.get("/failas", async (req, res) => {
    let humanStatistika = structuredClone(statistika);
    humanStatistika.dydziai = Object.fromEntries(
        Object.entries(humanStatistika.dydziai).map(([key, value]) => {
            if (value < 1024) {
                return [key, `${value} B`];
            } else if (value < 1024 * 1024) {
                return [`${key}`, `${(value / 1024).toFixed(2)} KB`];
            } else if (value < 1024 * 1024 * 1024) {
                return [`${key}`, `${(value / (1024 * 1024)).toFixed(2)} MB`];
            } else {
                return [
                    `${key}`,
                    `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`,
                ];
            }
        }),
    );

    // Render the failai page with the statistics
    res.render("failai/failai", {
        title: "Failai",
        statistika: humanStatistika,
        customHead: config.customHead,
    });
});

failasRouter.get("/failas.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Failai",
        "Failų parsisiuntimo statistika",
        "",
        "viespirkiai.top/failas",
    );
});

failasRouter.get("/failas/:dokId/:fileId/download", async (req, res, next) => {
    let { dokId, fileId } = req.params;

    // Randame failą
    const failasRezultatai = await postgres.query(
        'SELECT * FROM failai WHERE "dokId" = $1 AND "fileId" = $2;',
        [dokId, fileId],
    );

    // 404
    if (failasRezultatai.rows.length === 0) {
        return next();
    }

    const failas = failasRezultatai.rows[0];

    // Patikriname, ar failas yra parsiųstas
    if (failas.parsiustas === 0) {
        return res.status(404).send("Failas dar neparsiųstas.");
    }

    const dezeRes = await postgres.query(
        "SELECT * FROM dezes WHERE pavadinimas = $1 LIMIT 1",
        [failas.saugojama],
    );

    if (dezeRes.rows.length === 0) {
        return res.status(404).send("Dėžė nerasta.");
    }

    const deze = dezeRes.rows[0];

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
        `inline; filename*=UTF-8''${encodeURIComponent(failas.pavadinimas)}`,
    );

    // Nustatome failo tipą
    const contentType =
        mime.getType(failas.extension) || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", failas.dydis);

    // Persiunčiame failą
    const nodeStream = Readable.fromWeb(failasBlob.body);
    nodeStream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
            res.status(500).send("Error streaming file.");
        } else {
            res.destroy(err);
        }
    });

    nodeStream.pipe(res);
});

export default failasRouter;
