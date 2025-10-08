import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import { arrayToLithuanianTime } from "../utils/time.js";
import { buildTypesenseFilter, buildPostgresFilter } from "../utils/filter.js";
import { searchDocuments } from "../typesense/typesense.js";
import config from "../utils/config.js";
import { fixHtmlEntities } from "../utils/fixHtmlEntities.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";
import QueryStream from "pg-query-stream";
import { Readable } from "stream";

const indexRouter = express.Router();

let postgresSutarciuSkaicius;

async function atnaujintiSutarciuSkaiciu() {
    try {
        postgresSutarciuSkaicius = Number(
            (
                await postgres.query(`
      SELECT * FROM "eiluciuSkaiciai" WHERE "tableName" = 'sutartys';
    `)
            ).rows[0].rowCount,
        );
    } catch (e) {}
}

await atnaujintiSutarciuSkaiciu();
setInterval(atnaujintiSutarciuSkaiciu, 15 * 60 * 1000); // 15min

indexRouter.get("/", cleanEmptyQueryParams, async (req, res) => {
    const startas = performance.now();

    // Limitas, kiek rodyti viename puslapyje
    let limit = 50;
    const MAX_POSTGRES_LIMIT = 1000_000;
    const MAX_TYPESENSE_LIMIT = 250;

    if (req.query.limit == "max" && req.query.search) {
        limit = MAX_TYPESENSE_LIMIT;
    } else if (req.query.limit == "max") {
        limit = MAX_POSTGRES_LIMIT;
    } else if (
        parseInt(req.query.limit) > MAX_TYPESENSE_LIMIT &&
        req.query.search
    ) {
        return res
            .status(400)
            .send(
                `Limitas per didelis. Maksimalus limitas tekstinėms paieškoms po ${MAX_TYPESENSE_LIMIT} rezultatų puslapyje.`,
            );
    } else if (parseInt(req.query.limit) > MAX_POSTGRES_LIMIT) {
        return res
            .status(400)
            .send(
                `Limitas per didelis. Maksimalus limitas ne tekstinėms paieškoms yra ${MAX_POSTGRES_LIMIT} rezultatų puslapyje.`,
            );
    } else if (parseInt(req.query.limit) > 0) {
        limit = parseInt(req.query.limit) || limit;
    }

    // Puslapis, kurį rodyti
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    let zinomasRezultatuSkaicius = true;
    if (req.query.search) {
        // Tekstinė paieška – Typesense
        var { filterBy, values, queryParams, usedHiddenFields } =
            buildTypesenseFilter(req.query);

        queryParams += `&search=${encodeURIComponent(req.query.search)}`;

        var { results, total } = await searchDocuments(
            req.query.search || "*",
            {
                page: page,
                filterBy,
                sortBy: "paskutinioRedagavimoData:desc",
                limit,
            },
        );

        results = arrayToLithuanianTime(results);

        var paieškosVariklis = "Typesense";
    } else {
        // Ne tekstinė paieška – Postgres
        var {
            sql,
            sqlCount,
            params,
            values,
            queryParams,
            usedHiddenFields,
            visiIrasai,
        } = buildPostgresFilter(req.query, limit, page);

        var results, total, client;
        if (req.query.csv || req.query.jsonl) {
            client = await postgres.connect();

            const query = new QueryStream(sql, params);
            var results = client.query(query);
        } else if (req.query.rezultatuSkaiciausPatikslinimas) {
            let count = await postgres.query(sqlCount, params.slice(0, -2));
            total =
                params.length === 1
                    ? postgresSutarciuSkaicius
                    : parseInt(count.rows[0].count, 10);
            zinomasRezultatuSkaicius = true;
            results = [];
        } else {
            if (visiIrasai) {
                // all results, no count needed
                let resultsRes = await postgres.query(sql, params);
                results = resultsRes.rows;
                total = postgresSutarciuSkaicius;
                zinomasRezultatuSkaicius = true;
            } else {
                // borrow a dedicated client for the count query
                const countClient = await postgres.connect();

                // start both queries immediately
                const resultsPromise = postgres.query(sql, params);
                const countPromise = countClient.query(
                    sqlCount,
                    params.slice(0, -2),
                );

                // wait for results first
                const resultsStart = Date.now();
                const resultsRes = await resultsPromise;
                const resultsTime = Date.now() - resultsStart; // in ms

                // now wait for count query, giving it resultsTime + 0.5  s
                try {
                    const countRes = await Promise.race([
                        countPromise,
                        new Promise((_, reject) =>
                            setTimeout(
                                () => reject(new Error("timeout")),
                                resultsTime + 500,
                            ),
                        ),
                    ]);

                    total =
                        params.length === 1
                            ? postgresSutarciuSkaicius
                            : parseInt(countRes.rows[0].count, 10);
                    zinomasRezultatuSkaicius = true;
                } catch (err) {
                    // cancel count query if still running
                    try {
                        await pg.CancelQuery(countClient, countPromise);
                    } catch (_) {}

                    total = null;
                    zinomasRezultatuSkaicius = false;
                } finally {
                    countClient.release();
                }

                results = resultsRes.rows;
            }

            // change sutartiesUnikalusId to sutartiesUnikalusID
            results = results.map((result) => {
                result.sutartiesUnikalusID = result.sutartiesUnikalusId;
                delete result.sutartiesUnikalusId;
                return result;
            });
        }
        var paieškosVariklis = "PostgreSQL";
    }

    for (let i = 0; i < results.length; i++) {
        results[i].pavadinimas = fixHtmlEntities(results[i].pavadinimas);
        results[i].perkanciojiOrganizacija = fixHtmlEntities(
            results[i].perkanciojiOrganizacija,
        );
        results[i].tiekejas = fixHtmlEntities(results[i].tiekejas);

        const contractTypes = {
            TSP: "Tarptautinis arba supaprastintas pirkimas",
            MVP: "Mažos vertės pirkimas",
            ŽS: "Žodinė sutartis",
            MVPŽ: "Mažos vertės žodinis pirkimas",
            SPŽ: "Supaprastintos vertės žodinis pirkimas",
            PPS: "Pagrindinė pirkimo sutartis",
            VS: "Vidaus sandoris",
            SP: "Sutarties pakeitimas",
            PSĮ: "Pirkimas iš susijusios įmonės",
            "ILGALAIKĖ MVPŽ": "Ilgalaikė mažos vertės žodinė sutartis",
        };

        const tipo = (results[i].tipas || "").trim().toUpperCase();
        results[i].tipoPavadinimas = contractTypes[tipo] || tipo;
    }

    // Paieškos užklausos informacija
    let trukme = ((performance.now() - startas) / 1000).toFixed(2) + "s";
    let rodomiRezultatai = results.length;
    if (req.query.rezultatuSkaiciausPatikslinimas) {
        rodomiRezultatai = limit;
    }
    let rodomasTotal = zinomasRezultatuSkaicius
        ? total
        : `<span class="rezultatai-nezinomas-total"> ? </span>`;

    let numberOfResults;

    if (zinomasRezultatuSkaicius) {
        if (rodomiRezultatai < total) {
            numberOfResults = `Rodomi ${rodomiRezultatai} iš ${Number(rodomasTotal).linksniuotiK(["rezultato", "rezultatų"])} <pre style="display: inline;">(${trukme}, ${paieškosVariklis})</pre>`;
        } else {
            numberOfResults = `${Number(rodomasTotal).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} <pre style="display: inline;">(${trukme}, ${paieškosVariklis})</pre>`;
        }
    } else {
        // total unknown
        numberOfResults = `Rodomi ${rodomiRezultatai} iš ${rodomasTotal} rezultatų <pre style="display: inline;"> (${trukme}, ${paieškosVariklis})</pre>`;
        total = 10_000; // for pagination
    }

    if (req.query.rezultatuSkaiciausPatikslinimas) {
        res.json({
            zinomasRezultatuSkaicius,
            total,
            numberOfResults,
        });
        return;
    }

    // Jei prašo JSONL
    if (req.query.jsonl) {
        res.setHeader("Content-Type", "application/x-ndjson");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=viespirkiai-${new Date().toISOString()}.jsonl`,
        );

        let count = 0;

        try {
            results.on("data", (row) => {
                row.sutartiesUnikalusID = row.sutartiesUnikalusId;
                delete row.sutartiesUnikalusId;

                const line = JSON.stringify(row) + "\n";

                res.write(line);

                count++;
                if (count % 1000 === 0 && res.flush) res.flush();
            });

            await new Promise((resolve, reject) => {
                results.on("end", resolve);
                results.on("error", reject);
            });
        } finally {
            client.release();
            return res.end();
        }
    }

    // Jei prašo CSV
    if (req.query.csv) {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=viespirkiai-${new Date().toISOString()}.csv`,
        );
        res.setHeader("Content-Transfer-Encoding", "binary");

        const escapeCSV = (value) => {
            if (value == null) return "";
            const str = String(value);
            return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        };

        const formatDate = (value) => {
            if (!value) return "";
            const date = new Date(value);
            return isNaN(date) ? "" : date.toISOString().split("T")[0];
        };

        const header =
            [
                "Tipas",
                "Kategorija",
                "Pavadinimas",
                "Numatyta vertė",
                "Faktinė vertė",
                "Pirkėjo pavadinimas",
                "Pirkėjo kodas",
                "Tiekėjo pavadinimas",
                "Tiekėjo kodas",
                "Sudarymo data",
                "Faktinė įvykdymo data",
                "Redagavimo data",
                "BVPZ kodas",
                "Sutarties numeris",
                "Unikalus ID",
            ].join(",") + "\n";

        res.write(header);

        let count = 0;

        try {
            results.on("data", (row) => {
                row.sutartiesUnikalusID = row.sutartiesUnikalusId;
                delete row.sutartiesUnikalusId;

                const values = [
                    row.tipas,
                    row.kategorija,
                    row.pavadinimas,
                    row.verte,
                    row.faktineVerte || "",
                    row.perkanciojiOrganizacija,
                    row.perkanciosiosOrganizacijosKodas,
                    row.tiekejas,
                    row.tiekejoKodas,
                    formatDate(row.sudarymoData),
                    formatDate(row.faktineIvykdymoData),
                    formatDate(row.paskutinioRedagavimoData),
                    row.bvpzKodas || "",
                    row.sutartiesNumeris || "",
                    row.sutartiesUnikalusID,
                ];

                const csvLine = values.map(escapeCSV).join(",") + "\n";

                res.write(csvLine);

                count++;
                if (count % 1000 === 0 && res.flush) res.flush();
            });

            await new Promise((resolve, reject) => {
                results.on("end", resolve);
                results.on("error", reject);
            });
        } finally {
            client.release();
            return res.end();
        }
    }

    let galimaEksportuoti = true;
    if (req.query.search && total > MAX_TYPESENSE_LIMIT) {
        galimaEksportuoti = false;
    } else if (total > MAX_POSTGRES_LIMIT) {
        galimaEksportuoti = false;
    }

    const totalPages = Math.ceil(total / limit);

    res.set("Cache-Control", "public, max-age=10, s-maxage=10");

    let naujaPaieska;

    if (req.query.naujaPaieska !== undefined) {
        // query param takes priority
        naujaPaieska = req.query.naujaPaieska === "true";
    } else if (req.cookies.naujaPaieska !== undefined) {
        // fallback to cookie
        naujaPaieska = req.cookies.naujaPaieska === "true";
    } else {
        // default
        naujaPaieska = true;
    }

    if (naujaPaieska === false) {
        res.cookie("naujaPaieska", "false", {
            httpOnly: true,
            sameSite: "Lax",
        });
    } else {
        res.clearCookie("naujaPaieska");
    }

    res.render("index", {
        data: results,
        values,
        usedHiddenFields,
        currentPage: page,
        pageCount: totalPages,
        numberOfResults,
        zinomasRezultatuSkaicius,
        queryParams,
        customHead: config.customHead,
        galimaEksportuoti,
        naujaPaieska,
        req,
    });
});

indexRouter.get("/index.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Pirkimų skelbimų paieška",
        "Viešpirkiai",
        "",
        "viespirkiai.top",
    );
});

export default indexRouter;
