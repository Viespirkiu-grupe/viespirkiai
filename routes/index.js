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
import Timings from "../utils/timings.js";

const indexRouter = express.Router();

indexRouter.get("/", cleanEmptyQueryParams, async (req, res, next) => {
    let timings = new Timings();
    timings.start("req");

    timings.start("sutarciuSkaicius");
    let postgresSutarciuSkaicius = Number(
        (
            await postgres.query(`
              SELECT * FROM "eiluciuSkaiciai" WHERE "tableName" = 'sutartys';
            `)
        ).rows[0].rowCount,
    );
    timings.end("sutarciuSkaicius");

    const startas = performance.now();

    // Limitas, kiek rodyti viename puslapyje
    let limit = 50;
    const MAX_POSTGRES_LIMIT = 1000_000;
    const MAX_TYPESENSE_LIMIT = 5_000;

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

    let zinomasRezultatuSkaicius = true;
    if (req.query.search) {
        timings.start("typesense");
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
        timings.end("typesense");

        timings.start("dateConversion");
        results = arrayToLithuanianTime(results);
        timings.end("dateConversion");

        var paieškosVariklis = "Typesense";
    } else {
        // Ne tekstinė paieška – Postgres
        timings.start("postgres");
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

                const resultsStart = Date.now();

                let resultsRes;
                try {
                    // wait for results first
                    resultsRes = await resultsPromise;
                } finally {
                    // measure how long it took
                    var resultsTime = Date.now() - resultsStart;
                }

                try {
                    // wait for count with timeout = resultsTime + 500ms
                    const countRes = await Promise.race([
                        countPromise,
                        new Promise((_, reject) =>
                            setTimeout(
                                () => reject(new Error("timeout")),
                                resultsTime + 100,
                            ),
                        ),
                    ]);

                    total =
                        params.length === 1
                            ? postgresSutarciuSkaicius
                            : parseInt(countRes.rows[0].count, 10);

                    zinomasRezultatuSkaicius = true;
                } catch (err) {
                    // timeout or error → cancel count query if still running
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
            timings.end("postgres");
        }
        var paieškosVariklis = "PostgreSQL";
    }

    timings.start("postProcessing");
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
    timings.end("postProcessing");

    timings.start("requestInformation");
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
    timings.end("requestInformation");

    if (req.query.rezultatuSkaiciausPatikslinimas) {
        res.render(
            "pagination",
            {
                currentPage: page,
                pageCount: Math.ceil(total / limit),
                numberOfResults,
                total,
                queryParams,
            },
            (err, html) => {
                if (err) {
                    return next(err);
                }

                res.json({
                    zinomasRezultatuSkaicius,
                    total,
                    numberOfResults,

                    pagination: html,
                });
            },
        );
        return;
    }

    // Jei prašo JSONL
    if (req.query.jsonl) {
        if (req.query.search) {
            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename=viespirkiai-${new Date().toISOString()}.jsonl`,
            );

            for (let i = 0; i < results.length; i++) {
                const line = JSON.stringify(results[i]) + "\n";
                res.write(line);
            }

            return res.end();
        } else {
            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename=viespirkiai-${new Date().toISOString()}.jsonl`,
            );

            let count = 0;

            try {
                results.on("data", (row) => {
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

        if (req.query.search) {
            for (let i = 0; i < results.length; i++) {
                const row = results[i];

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
            }

            return res.end();
        } else {
            let count = 0;

            try {
                results.on("data", (row) => {
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

    let analize;
    if (req.query.analize) {
        analize = {};

        // Find top tipas in results
        analize.tipai = {};

        results.forEach((result) => {
            const tipas = result.tipas || "Nežinomas";
            if (!analize.tipai[tipas]) {
                analize.tipai[tipas] = 0;
            }
            analize.tipai[tipas]++;
        });

        // Convert to array and sort by count
        analize.tipai = Object.entries(analize.tipai)
            .map(([tipas, count]) => ({ tipas, count }))
            .sort((a, b) => b.count - a.count);

        // Sumos vs datos, array of {data, suma}
        analize.sumosVsDatos = {};

        results.forEach((result) => {
            const data = result.sudarymoData
                ? new Date(result.sudarymoData).toISOString().split("T")[0]
                : "Nežinoma";
            if (!analize.sumosVsDatos[data]) {
                analize.sumosVsDatos[data] = 0;
            }
            analize.sumosVsDatos[data] += parseFloat(result.verte) || 0;
        });

        // Convert to array and sort by date
        analize.sumosVsDatos = Object.entries(analize.sumosVsDatos)
            .map(([data, suma]) => ({ data, suma }))
            .sort((a, b) => new Date(a.data) - new Date(b.data));

        // Suma pagal metus kur tipas != SP
        analize.metinesSumos = {};

        results.forEach((result) => {
            const data = result.sudarymoData
                ? new Date(result.sudarymoData)
                : null;
            const tipas = result.tipas ? result.tipas.trim().toUpperCase() : "";
            if (data && tipas !== "SP") {
                const metai = data.getFullYear();
                if (!analize.metinesSumos[metai]) {
                    analize.metinesSumos[metai] = 0;
                }
                analize.metinesSumos[metai] += parseFloat(result.verte) || 0;
            }
        });
        // Convert to array and sort by year
        analize.metinesSumos = Object.entries(analize.metinesSumos)
            .map(([metai, suma]) => ({ metai, suma }))
            .sort((a, b) => a.metai - b.metai);
    }

    res.setHeader("Server-Timing", timings.serverTiming());

    res.renderCompiled("sutartys/index", {
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
        analize,
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
