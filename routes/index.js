import express from "express";
import { viespirkiai } from "../mongo/mongoDb.js";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import { arrayToLithuanianTime } from "../utils/time.js";
import { buildTypesenseFilter, buildMongoFilter } from "../utils/filter.js";
import { searchDocuments } from "../typesense/typesense.js";
import config from "../utils/config.js";
import { fixHtmlEntities } from "../utils/fixHtmlEntities.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const indexRouter = express.Router();

let sutarciuSkaicius;

async function atnaujintiSutarciuSkaiciu() {
    sutarciuSkaicius = await viespirkiai.estimatedDocumentCount();
}

await atnaujintiSutarciuSkaiciu();
setInterval(atnaujintiSutarciuSkaiciu, 15 * 60 * 1000); // 15min

indexRouter.get("/", cleanEmptyQueryParams, async (req, res) => {
    const startas = performance.now();

    // Limitas, kiek rodyti viename puslapyje
    let limit = 50;
    const MAX_MONGO_LIMIT = 10000;
    const MAX_TYPESENSE_LIMIT = 250;

    if (req.query.limit == "max" && req.query.search) {
        limit = MAX_TYPESENSE_LIMIT;
    } else if (req.query.limit == "max") {
        limit = MAX_MONGO_LIMIT;
    } else if (
        parseInt(req.query.limit) > MAX_TYPESENSE_LIMIT &&
        req.query.search
    ) {
        return res
            .status(400)
            .send(
                `Limitas per didelis. Maksimalus limitas tekstinėms paieškoms po ${MAX_TYPESENSE_LIMIT} rezultatų puslapyje.`,
            );
    } else if (parseInt(req.query.limit) > MAX_MONGO_LIMIT) {
        return res
            .status(400)
            .send(
                `Limitas per didelis. Maksimalus limitas ne tekstinėms paieškoms yra ${MAX_MONGO_LIMIT} rezultatų puslapyje.`,
            );
    } else if (parseInt(req.query.limit) > 0) {
        limit = parseInt(req.query.limit) || limit;
    }

    // Puslapis, kurį rodyti
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

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

        var paieškosVariklis = "Typesense";
    } else {
        // Ne tekstinė paieška – MongoDB
        var { filter, values, queryParams, usedHiddenFields } =
            buildMongoFilter(req.query);

        if (Object.keys(filter).length === 0) {
            var total = sutarciuSkaicius;
        } else {
            var total = await viespirkiai.countDocuments(filter);
        }

        var results = await viespirkiai
            .find(filter)
            .sort({ paskutinioRedagavimoData: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        var paieškosVariklis = "MongoDB";
    }

    // Pataisomi HTML simboliai
    for (let i = 0; i < results.length; i++) {
        results[i].pavadinimas = fixHtmlEntities(results[i].pavadinimas);
        results[i].perkanciojiOrganizacija = fixHtmlEntities(
            results[i].perkanciojiOrganizacija,
        );
        results[i].tiekejas = fixHtmlEntities(results[i].tiekejas);
    }

    // Pakeičiame datų formatą į lietuvišką
    results = arrayToLithuanianTime(results);

    // Paieškos užklausos informacija
    let trukme = ((performance.now() - startas) / 1000).toFixed(2) + "s";
    let rodomiRezultatai = results.length;
    if (rodomiRezultatai < total) {
        var numberOfResults = `Rodomi ${rodomiRezultatai} iš ${total} rezultatų <pre style="display: inline;">(${trukme}, ${paieškosVariklis})</pre>`;
    } else {
        var numberOfResults = `${total} rezultatas(-ai) <pre style="display: inline;">(${trukme}, ${paieškosVariklis})</pre>`;
    }

    // Jei prašo JSON
    if (req.query.json) {
        return res.json(results);
    }

    // Jei prašo JSONL
    if (req.query.jsonl) {
        res.setHeader("Content-Type", "application/x-ndjson");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=viespirkiai-${new Date().toISOString()}.jsonl`,
        );
        for (const result of results) {
            res.write(JSON.stringify(result) + "\n");
        }
        return res.end();
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
            if (typeof value === "number") return value; // keep as number
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

        for (const row of results) {
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

        res.end();
        return;
    }

    let galimaEksportuoti = true;
    if (req.query.search && total > MAX_TYPESENSE_LIMIT) {
        galimaEksportuoti = false;
    } else if (total > MAX_MONGO_LIMIT) {
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
        queryParams,
        customHead: config.customHead,
        galimaEksportuoti,
        naujaPaieska,
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
