import express from "express";
import { postgres } from "../postgres/postgres.js";
import config from "../utils/config.js";

const statusRouter = express.Router();

statusRouter.get("/status/:pavadinimas", async (req, res, next) => {
    let { pavadinimas } = req.params;
    if (!pavadinimas) {
        return next();
    }

    let json = false;
    if (pavadinimas.endsWith(".json")) {
        json = true;
        pavadinimas = pavadinimas.slice(0, -5);
    }

    if (pavadinimas != "eviesiejipirkimai.lt") {
        return next();
    }

    let apjungtiRes = await postgres.query(`
      WITH ordered AS (
          SELECT
              id,
              "timestamp",
              tipas,
              "timestamp"
                - LAG("timestamp") OVER (PARTITION BY tipas ORDER BY "timestamp") AS delta
          FROM public."eviesiejipirkimaiGedimai"
      ),
      groups AS (
          SELECT
              *,
              SUM(CASE WHEN delta IS NULL OR delta > INTERVAL '5 minutes' THEN 1 ELSE 0 END)
                  OVER (PARTITION BY tipas ORDER BY "timestamp") AS grp
          FROM ordered
      ),
      intervals AS (
          SELECT
              tipas,
              MIN("timestamp") AS start_time,
              MAX("timestamp") AS end_time,
              MAX("timestamp") - MIN("timestamp") AS duration,
              COUNT(*) AS unmerged_count      -- raw events inside this merged interval
          FROM groups
          GROUP BY tipas, grp
      )
      SELECT
          start_time::date AS day,
          SUM(duration) AS total_duration,
          COUNT(*) AS merged_incidents,          -- number of merged groups on that day
          SUM(unmerged_count) AS unmerged_events -- raw count before merging
      FROM intervals
      GROUP BY day
      ORDER BY day DESC;`);

    let apjungti = apjungtiRes.rows;

    // Add all timestamps by day to the apjungti data
    let timestampaiRes = await postgres.query(`
        SELECT "timestamp"
        FROM public."eviesiejipirkimaiGedimai"
        ORDER BY "timestamp" DESC;
    `);

    let timestampai = timestampaiRes.rows.map((r) => r.timestamp);

    let timestampaiByDay = {};
    for (let ts of timestampai) {
        let d = new Date(ts);
        let day =
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0");
        if (!timestampaiByDay[day]) timestampaiByDay[day] = [];
        timestampaiByDay[day].push(ts);
    }

    // To each array item by its day, add the timestamps
    for (let item of apjungti) {
        let day = item.day;
        item.timestamps = timestampaiByDay[day] || [];
    }

    let intervalaiRes = await postgres.query(`
      WITH ordered AS (
          SELECT
              id,
              "timestamp",
              tipas,
              "timestamp"
                - LAG("timestamp") OVER (PARTITION BY tipas ORDER BY "timestamp") AS delta
          FROM public."eviesiejipirkimaiGedimai"
      ),
      groups AS (
          SELECT
              *,
              SUM(CASE WHEN delta IS NULL OR delta > INTERVAL '5 minutes' THEN 1 ELSE 0 END)
                  OVER (PARTITION BY tipas ORDER BY "timestamp") AS grp
          FROM ordered
      ),
      intervals AS (
          SELECT
              tipas,
              MIN("timestamp") AS start_time,
              MAX("timestamp") AS end_time
          FROM groups
          GROUP BY tipas, grp
      )
      SELECT
          tipas,
          start_time,
          end_time
      FROM intervals
      ORDER BY start_time;
    `);

    let intervalai = intervalaiRes.rows;

    for (let item of apjungti) {
        let day = item.day;
        item.intervals = intervalai.filter((interval) => {
            let d = new Date(interval.start_time);
            let intervalDay =
                d.getFullYear() +
                "-" +
                String(d.getMonth() + 1).padStart(2, "0") +
                "-" +
                String(d.getDate()).padStart(2, "0");
            return intervalDay === day;
        });
    }

    let paskutinioGedimoTimestamp = await postgres.query(`
        SELECT "timestamp"
        FROM public."eviesiejipirkimaiGedimai"
        ORDER BY "timestamp" DESC
        LIMIT 1;
    `);

    let paskutinisGedimas = paskutinioGedimoTimestamp.rows[0] || null;
    let paskutinisGedimasPer5min = false;
    if (paskutinisGedimas) {
        let dabar = new Date();
        let gedimoLaikas = new Date(paskutinisGedimas.timestamp);
        let skirtumasMs = dabar - gedimoLaikas;
        if (skirtumasMs <= 5 * 60 * 1000) {
            paskutinisGedimasPer5min = true;
        }
    }
    paskutinisGedimas = {
        ...paskutinisGedimas,
        per5min: paskutinisGedimasPer5min,
    };

    if (json) {
        return res.json({ apjungti });
    }

    res.render("status/status", {
        status: { apjungti, paskutinisGedimas },
        customHead: config.customHead,
    });
});

export default statusRouter;
