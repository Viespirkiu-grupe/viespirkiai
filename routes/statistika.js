import express from "express";
import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const statistikaRouter = express.Router();

let cache = null;
let cacheTime = 0;

function formatBytes(value) {
    if (value < 1024) {
        return `${value} B`;
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(2)} KB`;
    }
    if (value < 1024 * 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDateTime(dateInput) {
    return new Date(dateInput).toLocaleString("lt-LT", { hour12: false });
}

function humanizeStatistika(statistika) {
    let humanStatistika = structuredClone(statistika);
    humanStatistika.failai.dydziai = Object.fromEntries(
        Object.entries(humanStatistika.failai.dydziai).map(([key, value]) => {
            return [key, formatBytes(value)];
        }),
    );

    return humanStatistika;
}

function buildSsePayload(humanStatistika) {
    return {
        atnaujinta: formatDateTime(humanStatistika.atnaujinta),
        failai: humanStatistika.failai,
        nuskaitymas: {
            zodziai: {
                total: Number(humanStatistika.nuskaitymas.zodziai.total).linksniuoti([
                    "žodis",
                    "žodžiai",
                    "žodžių",
                    "žodžio",
                ]),
                vidurkis: Number(
                    humanStatistika.nuskaitymas.zodziai.vidurkis,
                ).linksniuoti(["žodis", "žodžiai", "žodžių", "žodžio"]),
                vidurkisNeNulis: Number(
                    humanStatistika.nuskaitymas.zodziai.vidurkisNeNulis,
                ).linksniuoti(["žodis", "žodžiai", "žodžių", "žodžio"]),
                failuSuZodziaisDalis: `${Number(
                    humanStatistika.nuskaitymas.zodziai.failuSuZodziaisDalis,
                ).toFixed(2)} %`,
            },
            pagalVersija: humanStatistika.nuskaitymas.pagalVersija.map(
                (versija) => ({
                    status: versija.status,
                    kiekis: Number(versija.kiekis).toLocaleString("lt-LT"),
                    procentai: `${Number(versija.procentai).toLocaleString("lt-LT")} %`,
                }),
            ),
        },
        topDokNuskaitytojai: humanStatistika.topDokNuskaitytojai.map(
            (nuskaitytojas) => ({
                viesasPavadinimas: nuskaitytojas.viesasPavadinimas,
                nuskaitytidokumentai: Number(
                    nuskaitytojas.nuskaitytidokumentai,
                ).toLocaleString("lt-LT"),
            }),
        ),
        database: {
            uptime: Number(humanStatistika.database.uptime_seconds).convertUnit(
                "s",
            ),
            xact_commit: Number(
                humanStatistika.database.xact_commit,
            ).toLocaleString("lt-LT"),
            tup_inserted: Number(
                humanStatistika.database.tup_inserted,
            ).toLocaleString("lt-LT"),
            tup_updated: Number(
                humanStatistika.database.tup_updated,
            ).toLocaleString("lt-LT"),
            tup_deleted: Number(
                humanStatistika.database.tup_deleted,
            ).toLocaleString("lt-LT"),
            tup_fetched: Number(
                humanStatistika.database.tup_fetched,
            ).toLocaleString("lt-LT"),
        },
        lenteles: humanStatistika.lenteles.map((lentele) => ({
            tableName: lentele.tableName,
            dataSize: Number(lentele.dataSize).convertUnit("B"),
            indexSize: Number(lentele.indexSize).convertUnit("B"),
            totalSize: Number(lentele.totalSize).convertUnit("B"),
            approxRowCount: Number(lentele.approxRowCount).toLocaleString("lt-LT"),
            isTotal: lentele.tableName === "Iš viso",
        })),
    };
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a, b) {
    if (a === b) {
        return true;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            return false;
        }

        for (let i = 0; i < a.length; i += 1) {
            if (!deepEqual(a[i], b[i])) {
                return false;
            }
        }

        return true;
    }

    if (isObject(a) && isObject(b)) {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) {
            return false;
        }

        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) {
                return false;
            }

            if (!deepEqual(a[key], b[key])) {
                return false;
            }
        }

        return true;
    }

    return false;
}

function diffPayload(prev, next) {
    if (prev === null) {
        return next;
    }

    if (deepEqual(prev, next)) {
        return undefined;
    }

    if (Array.isArray(next)) {
        return next;
    }

    if (isObject(next) && isObject(prev)) {
        const diff = {};

        for (const key of Object.keys(next)) {
            const childDiff = diffPayload(prev[key], next[key]);
            if (childDiff !== undefined) {
                diff[key] = childDiff;
            }
        }

        return Object.keys(diff).length > 0 ? diff : undefined;
    }

    return next;
}

export async function gautiStatistika() {
    const now = Date.now();

    // Return cached result if it's still valid
    if (cache && now - cacheTime < 50) {
        return cache;
    }

    let statistika = {};

    const [failaiCountsRes, lentelesRes, topDokNuskaitytojaiRes, databaseRes] =
        await Promise.all([
            postgres.query(`SELECT metrika, eilute, verte FROM "failaiCounts";`),
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
                `SELECT
                current_database() AS db,
                xact_commit,
                xact_rollback,
                blks_read,
                blks_hit,
                tup_returned,
                tup_fetched,
                tup_inserted,
                tup_updated,
                tup_deleted,
                conflicts,
                deadlocks,
                temp_files,
                temp_bytes,
                extract(epoch from now() - stats_reset) AS stats_age_seconds,
                extract(epoch from now() - pg_postmaster_start_time()) AS uptime_seconds
            FROM pg_stat_database
            WHERE datname = current_database();`,
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
            neparsiusti:
                counts.visi -
                counts.parsiusti -
                counts.klaida -
                counts.extracted,
        },
        dydziai: {
            visi: (counts.dydis / counts.parsiusti) * counts.visi,
            klaida: (counts.dydis / counts.parsiusti) * counts.klaida,
            parsiusti: counts.dydis,
            neparsiusti:
                (counts.dydis / counts.parsiusti) *
                (counts.visi -
                    counts.parsiusti -
                    counts.klaida -
                    counts.extracted),
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
                statistika.failai.kiekiai.visi - counts.zodziuKiekisNeNulis,
            vidurkisNeNulis: counts.zodziuSuma / counts.zodziuKiekisNeNulis,
            failuSuZodziaisDalis:
                (counts.zodziuKiekisNeNulis / statistika.failai.kiekiai.visi) *
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
                procentai: (kiekis / statistika.failai.kiekiai.visi) * 100 || 0,
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

    statistika.topDokNuskaitytojai = topDokNuskaitytojaiRes.rows;

    statistika.database = databaseRes.rows[0];

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
    let humanStatistika = humanizeStatistika(statistika);

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

statistikaRouter.get("/statistika/sse", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }
    res.write("retry: 1000\n\n");

    let running = true;
    let lastPayload = null;
    let lastTimestampOnlySentAt = 0;
    const heartbeat = setInterval(() => {
        if (!running) {
            return;
        }
        res.write(": ping\n\n");
    }, 15000);

    req.on("close", () => {
        running = false;
        clearInterval(heartbeat);
    });

    const sendUpdate = async () => {
        const statistika = await gautiStatistika();
        const humanStatistika = humanizeStatistika(statistika);
        const nextPayload = buildSsePayload(humanStatistika);
        const payloadDelta = diffPayload(lastPayload, nextPayload);

        if (payloadDelta === undefined) {
            return;
        }

        const keys = Object.keys(payloadDelta);
        if (keys.length === 1 && keys[0] === "atnaujinta") {
            const now = Date.now();
            if (now - lastTimestampOnlySentAt < 1000) {
                return;
            }
            lastTimestampOnlySentAt = now;
        }

        lastPayload = nextPayload;
        res.write(`data: ${JSON.stringify(payloadDelta)}\n\n`);
    };

    const interval = setInterval(async () => {
        if (!running) {
            clearInterval(interval);
            return;
        }
        await sendUpdate();
    }, 100);
});

statistikaRouter.get("/statistika.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Statistika",
        "Viešpirkių statistika",
        "",
        "viespirkiai.org/statistika",
    );
});

export default statistikaRouter;
