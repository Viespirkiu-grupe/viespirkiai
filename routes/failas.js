import express from "express";
import { mysql } from "../mysql/mysql.js";
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
    const [visi, parsiusti, klaida, dydis] = await Promise.all([
        mysql.execute("SELECT COUNT(*) AS total FROM failai;"),
        mysql.execute(
            "SELECT COUNT(*) AS total FROM failai WHERE parsiustas = 1;",
        ),
        mysql.execute(
            "SELECT COUNT(*) AS total FROM failai WHERE parsiustas = -1;",
        ),
        mysql.execute(
            "SELECT SUM(dydis) AS total FROM failai WHERE parsiustas = 1;",
        ),
    ]);

    const visiKiekis = visi[0][0].total;
    const parsiustiKiekis = parsiusti[0][0].total;
    const klaidaKiekis = klaida[0][0].total;
    const neparsiustiKiekis = visiKiekis - parsiustiKiekis - klaidaKiekis;

    const parsiustiDydis = dydis[0][0].total || 0;
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
        visi: parseFloat(parseFloat(visuDydis).toFixed(2)),
        parsiusti: parseFloat(parseFloat(parsiustiDydis).toFixed(2)),
        klaida: parseFloat(parseFloat(klaidaDydis).toFixed(2)),
        neparsiusti: parseFloat(parseFloat(neparsiustiDydis).toFixed(2)),
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
    const [failasRezultatai] = await mysql.execute(
        "SELECT * FROM failai WHERE dokId = ? AND fileId = ?;",
        [dokId, fileId],
    );

    // 404
    if (failasRezultatai.length === 0) {
        return next();
    }

    let failas = failasRezultatai[0];

    // Patikriname, ar failas yra parsiųstas
    if (failas.parsiustas === 0) {
        return res.status(404).send("Failas dar neparsiųstas.");
    }

    // Randame dėžę, kurioje saugomas failas
    let [deze] = await mysql.execute(
        "SELECT * FROM dezes WHERE pavadinimas = ? LIMIT 1",
        [failas.saugojama],
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
        `inline; filename*=UTF-8''${encodeURIComponent(failas.pavadinimas)}`,
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
