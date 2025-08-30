import express from "express";
import { postgres } from "../postgres/postgres.js";
import { Readable } from "stream";
import mime from "mime";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const statistikaRouter = express.Router();

let statistika = {
    failai: {
        dydziai: {},
        kiekiai: {},
    },
};

async function atnaujintiStatistika() {
    const lentelesRes = await postgres.query(
        `SELECT
          s.relname AS "tableName",
          pg_table_size(s.relid) AS "dataSize",
          pg_indexes_size(s.relid) AS "indexSize",
          pg_total_relation_size(s.relid) AS "totalSize",
          st.n_live_tup AS "approxRowCount"
        FROM pg_catalog.pg_statio_user_tables s
        JOIN pg_catalog.pg_stat_user_tables st ON s.relid = st.relid
        ORDER BY s.relname ASC;`,
    );

    statistika.lenteles = lentelesRes.rows;

    statistika.lenteles.push({
        tableName: "Iš viso",
        dataSize: statistika.lenteles.reduce((a, b) => {
            const size = parseFloat(b.dataSize);
            return a + (isNaN(size) ? 0 : size);
        }, 0),
        indexSize: statistika.lenteles.reduce((a, b) => {
            const size = parseFloat(b.indexSize);
            return a + (isNaN(size) ? 0 : size);
        }, 0),
        totalSize: statistika.lenteles.reduce((a, b) => {
            const size = parseFloat(b.totalSize);
            return a + (isNaN(size) ? 0 : size);
        }, 0),
        approxRowCount: statistika.lenteles.reduce((a, b) => {
            const size = parseInt(b.approxRowCount, 10);
            return a + (isNaN(size) ? 0 : size);
        }, 0),
    });

    // Failai
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

    statistika.failai.kiekiai = {
        visi: visiKiekis,
        parsiusti: parsiustiKiekis,
        klaida: klaidaKiekis,
        neparsiusti: neparsiustiKiekis,
    };

    statistika.failai.dydziai = {
        visi: parseFloat(visuDydis),
        parsiusti: parseFloat(parsiustiDydis),
        klaida: parseFloat(klaidaDydis),
        neparsiusti: parseFloat(neparsiustiDydis),
    };

    statistika.atnaujinta = new Date();

    await postgres.query(
        `INSERT INTO statistika (timestamp, data)
             VALUES ($1, $2)`,
        [statistika.atnaujinta, statistika],
    );
}

setInterval(atnaujintiStatistika, 1000 * 60 * 5); // kas 5 min.
atnaujintiStatistika(); // paleidimas iš karto

statistikaRouter.get("/statistika", async (req, res) => {
    let humanStatistika = structuredClone(statistika);
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
