import express from "express";
import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";

const statusRouter = express.Router();

/**
 * @param {Date} d
 * @returns {string} YYYY-MM-DD
 */
function toIsoDay(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * @returns {Promise<object[]>}
 */
async function fetchApjungti() {
    const result = await postgres.query(`
        WITH ordered AS (
            SELECT id, "timestamp", tipas,
                "timestamp" - LAG("timestamp") OVER (PARTITION BY tipas ORDER BY "timestamp") AS delta
            FROM public."eviesiejipirkimaiGedimai"
        ),
        groups AS (
            SELECT *,
                SUM(CASE WHEN delta IS NULL OR delta > INTERVAL '5 minutes' THEN 1 ELSE 0 END)
                    OVER (PARTITION BY tipas ORDER BY "timestamp") AS grp
            FROM ordered
        ),
        intervals AS (
            SELECT tipas, MIN("timestamp") AS start_time, MAX("timestamp") AS end_time,
                MAX("timestamp") - MIN("timestamp") AS duration,
                COUNT(*) AS unmerged_count
            FROM groups
            GROUP BY tipas, grp
        )
        SELECT
            start_time::date AS day,
            SUM(duration) AS total_duration,
            COUNT(*) AS merged_incidents,
            SUM(unmerged_count) AS unmerged_events
        FROM intervals
        GROUP BY day
        ORDER BY day DESC`);
    return result.rows;
}

/**
 * @returns {Promise<object[]>}
 */
async function fetchIntervalai() {
    const result = await postgres.query(`
        WITH ordered AS (
            SELECT id, "timestamp", tipas,
                "timestamp" - LAG("timestamp") OVER (PARTITION BY tipas ORDER BY "timestamp") AS delta
            FROM public."eviesiejipirkimaiGedimai"
        ),
        groups AS (
            SELECT *,
                SUM(CASE WHEN delta IS NULL OR delta > INTERVAL '5 minutes' THEN 1 ELSE 0 END)
                    OVER (PARTITION BY tipas ORDER BY "timestamp") AS grp
            FROM ordered
        ),
        intervals AS (
            SELECT tipas, MIN("timestamp") AS start_time, MAX("timestamp") AS end_time
            FROM groups
            GROUP BY tipas, grp
        )
        SELECT tipas, start_time, end_time FROM intervals ORDER BY start_time`);
    return result.rows;
}

/**
 * @returns {Promise<{ timestamp: Date } | null>}
 */
async function fetchPaskutinisGedimas() {
    const result = await postgres.query(`
        SELECT "timestamp" FROM public."eviesiejipirkimaiGedimai"
        ORDER BY "timestamp" DESC LIMIT 1`);

    const row = result.rows[0] ?? null;
    if (!row) return null;

    const per5min =
        Date.now() - new Date(row.timestamp).getTime() <= 5 * 60 * 1000;
    return { ...row, per5min };
}

/**
 * @param {object[]} apjungti
 * @param {Date[]} timestamps
 * @param {object[]} intervalai
 */
function enrichApjungti(apjungti, timestamps, intervalai) {
    const byDay = Map.groupBy(timestamps, (ts) => toIsoDay(new Date(ts)));

    for (const item of apjungti) {
        const day = toIsoDay(new Date(item.day));
        item.timestamps = byDay.get(day) ?? [];
        item.intervals = intervalai.filter(
            (i) => toIsoDay(new Date(i.start_time)) === day,
        );
    }
}

statusRouter.get("/status/:pavadinimas", async (req, res, next) => {
    let { pavadinimas } = req.params;
    if (!pavadinimas) return next();

    const json = pavadinimas.endsWith(".json");
    if (json) pavadinimas = pavadinimas.slice(0, -5);
    if (pavadinimas !== "eviesiejipirkimai.lt") return next();

    const [apjungti, intervalai, allTimestamps, paskutinisGedimas] =
        await Promise.all([
            fetchApjungti(),
            fetchIntervalai(),
            postgres
                .query(
                    `SELECT "timestamp" FROM public."eviesiejipirkimaiGedimai" ORDER BY "timestamp" DESC`,
                )
                .then((r) => r.rows.map((r) => r.timestamp)),
            fetchPaskutinisGedimas(),
        ]);

    enrichApjungti(apjungti, allTimestamps, intervalai);

    if (json) return res.json({ apjungti });

    res.render("status/status", {
        status: { apjungti, paskutinisGedimas },
        customHead: config.customHead,
    });
});

export default statusRouter;
