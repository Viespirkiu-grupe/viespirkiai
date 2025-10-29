import express from "express";
import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { log } from "../utils/log.js";

const statistikaRouter = express.Router();

let cache = null;
let cacheTime = 0;

export async function gautiStatistika() {
    const now = Date.now();

    // Return cached result if it's still valid
    if (cache && now - cacheTime < 100) {
        return cache;
    }

    let statistika = {};

    const [
        failaiCountsRes,
        lentelesRes,
        topDokNuskaitytojaiRes,
        tokOcrNuskaitytojaiRes,
    ] = await Promise.all([
        postgres.query(`SELECT * FROM "failaiCounts";`),
        postgres.query(
            `SELECT
            s.relname AS "tableName",
            pg_table_size(s.relid) AS "dataSize",
            pg_indexes_size(s.relid) AS "indexSize",
            pg_table_size(s.relid) + pg_indexes_size(s.relid) AS "totalSize",
            st.n_live_tup AS "approxRowCount"
          FROM pg_catalog.pg_statio_user_tables s
          JOIN pg_catalog.pg_stat_user_tables st ON s.relid = st.relid
          ORDER BY s.relname ASC;`,
        ),
        postgres.query(
            `SELECT "nuskaitytidokumentai", "viesasPavadinimas" FROM "dokNuskaitytojai" ORDER BY "nuskaitytidokumentai" DESC LIMIT 100;`,
        ),
        postgres.query(
            `SELECT "nuskaitytiDokumentai", "viesasPavadinimas", "pavadinimas" FROM "ocrNuskaitytojai" ORDER BY "nuskaitytiDokumentai" DESC LIMIT 100;`,
        ),
    ]);

    const counts = failaiCountsRes.rows.reduce((acc, row) => {
        const { metrika, eilute, verte } = row;

        if (!acc[metrika]) {
            acc[metrika] = eilute === "ALL" ? verte : {};
        }

        if (eilute === "ALL") {
            acc[metrika] = verte;
        } else {
            acc[metrika][eilute] = verte;
        }

        return acc;
    }, {});

    statistika.failai = {
        kiekiai: {
            visi: counts.visi,
            klaida: counts.klaida,
            parsiusti: counts.parsiusti,
            neparsiusti: counts.visi - counts.parsiusti - counts.klaida,
        },
        dydziai: {
            visi: (counts.dydis / counts.parsiusti) * counts.visi,
            klaida: (counts.dydis / counts.parsiusti) * counts.klaida,
            parsiusti: counts.dydis,
            neparsiusti:
                (counts.dydis / counts.parsiusti) *
                (counts.visi - counts.parsiusti - counts.klaida),
        },
    };

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

    statistika.nuskaitymas = {
        zodziai: {
            total: counts.zodziuSuma,
            vidurkis: counts.zodziuSuma / counts.zodziuKiekis,
            failaiSuZodziais: counts.zodziuKiekisNeNulis,
            failaiBeZodziu:
                statistika.failai.kiekiai.parsiusti -
                counts.zodziuKiekisNeNulis,
            vidurkisNeNulis: counts.zodziuSuma / counts.zodziuKiekisNeNulis,
            failuSuZodziaisDalis:
                (counts.zodziuKiekisNeNulis /
                    statistika.failai.kiekiai.parsiusti) *
                100,
        },
    };

    // Loop over the object counts.nuskaitytas, turn it into an array
    // 	{ kiekis: 1247694, status: "3", procentai: 77.81 }
    // Sort by status strings lastly
    statistika.nuskaitymas.pagalVersija = Object.entries(counts.nuskaitytas)
        .map(([status, kiekis]) => {
            return {
                status,
                kiekis,
                procentai:
                    (kiekis / statistika.failai.kiekiai.parsiusti) * 100 || 0,
            };
        })
        .sort((a, b) => {
            return a.status.localeCompare(b.status);
        });

    // Tiek, kiek nėra didžiausio status (jei status string kuris nėra Nenuskaityta prisumuoti prie nenuskaitytų, kaip ir žemesnio lygmens)
    // likoNuskaityti – integer

    const didziausiasStatusas = statistika.nuskaitymas.pagalVersija
        .map((obj) => Number(obj.status)) // konvertuojame į skaičių
        .filter((n) => !isNaN(n)) // paliekame tik tikrus skaičius
        .reduce((max, n) => (n > max ? n : max), -Infinity);

    const nuskaitytaKiekis = statistika.nuskaitymas.pagalVersija.reduce(
        (sum, obj) => {
            const statusNum = Number(obj.status);
            if (
                obj.status === String(didziausiasStatusas) ||
                (obj.status !== "Nenuskaityta" && isNaN(Number(obj.status)))
            ) {
                return sum + obj.kiekis;
            }
            return sum;
        },
        0,
    );

    statistika.nuskaitymas.likoNuskaityti =
        statistika.failai.kiekiai.parsiusti - nuskaitytaKiekis;

    statistika.nuskaitymas.zodziuSkaicius =
        statistika.nuskaitymas.zodziai.total;

    // Top 10 extension pagal counts.extension keys
    statistika.topExtension = Object.entries(counts.extension)
        .map(([extension, count]) => ({
            ext: extension,
            row_count: count,
            percent: (count / statistika.failai.kiekiai.visi) * 100,
        }))
        .sort((a, b) => b.row_count - a.row_count)
        .slice(0, 10);

    statistika.ocrState = Object.entries(counts.ocrState)
        .map(([state, count]) => ({
            state: state,
            count: count,
            percent: (count / statistika.failai.kiekiai.visi) * 100,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    // Replace 0 → Galima nuskaityti (0), 1 → Nuskaityta (1), -3 → Rezervuota (-3)
    statistika.ocrState = statistika.ocrState.map((item) => {
        if (item.state === "0") {
            return { ...item, state: "Galima nuskaityti (0)" };
        } else if (item.state === "1") {
            return { ...item, state: "Nuskaityta (1)" };
        } else if (item.state === "-3") {
            return { ...item, state: "Rezervuota (-3)" };
        } else if (item.state === "NULL") {
            return { ...item, state: "Nenustatyta / nereikia (NULL)" };
        } else {
            return item;
        }
    });

    statistika.topDokNuskaitytojai = topDokNuskaitytojaiRes.rows;

    statistika.topOcrNuskaitytojai = tokOcrNuskaitytojaiRes.rows;

    // OCR rezervacijų skaičius
    statistika.topOcrNuskaitytojai.forEach((item) => {
        item.rezervuota = counts.checkedOutBy?.[item.pavadinimas] ?? 0;
        delete item.pavadinimas;
    });

    statistika.atnaujinta = new Date();

    cache = statistika;
    cacheTime = Date.now();
    return statistika;
}

statistikaRouter.get("/statistika.json", async (req, res) => {
    let statistika = await gautiStatistika();
    res.json(statistika);
});

statistikaRouter.get("/statistika", async (req, res) => {
    let statistika = await gautiStatistika();

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

    if (req.query.innerOnly) {
        return res.render("statistika/main", {
            statistika: humanStatistika,
        });
    }

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
