import express from "express";
import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const statistikaRouter = express.Router();

statistikaRouter.get("/statistika.json", async (req, res) => {
    let statistikaRes = await postgres.query(
        `SELECT * FROM statistika ORDER BY timestamp DESC LIMIT 1;`,
    );
    let statostikaRows = statistikaRes.rows[0].data;
    res.json(statostikaRows);
});

statistikaRouter.get("/statistika", async (req, res) => {
    let statistikaRes = await postgres.query(
        `SELECT * FROM statistika ORDER BY timestamp DESC LIMIT 1;`,
    );

    let humanStatistika = structuredClone(statistikaRes.rows[0].data);
    humanStatistika.failai.dydziai = Object.fromEntries(
        Object.entries(humanStatistika.failai.dydziai).map(([key, value]) => {
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
    res.render("statistika/statistika", {
        title: "Statistika",
        statistika: humanStatistika,
        customHead: config.customHead,
    });
});

statistikaRouter.get("/statistika.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Statistika",
        "Viešpirkių statistika",
        "",
        "viespirkiai.top/statistika",
    );
});

export default statistikaRouter;
