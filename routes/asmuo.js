import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { gautiSutarciuDuomenisPagalJarKoda } from "../modules/sutartys/pagalJarKoda.js";
import { getJuridinisInfo } from "../modules/juridiniai/getJuridinisInfo.js";
import { objectsToCSV } from "../utils/csv.js";
import { objectsToJsonlStream } from "../utils/jsonl.js";

const asmuoRouter = express.Router();

function parseJarKodas(raw) {
    if (raw.endsWith(".json"))
        return { jarKodas: raw.slice(0, -5), format: "json" };
    if (raw.endsWith(".png"))
        return { jarKodas: raw.slice(0, -4), format: "png" };
    return { jarKodas: raw, format: "html" };
}

function parseLimitai(query) {
    if (query.limitai === "false") return {};

    const defaults = {
        regitra: 5,
        teismoNuosprendziai: 10,
        sutartys: 10,
        darboSkelbimai: 5,
        rcPranesimai: 3,
        domenai: 3,
        pinreg: 3,
        kotis: 3,
        esInvesticijos: 5,
        mvpAprasai: 1,
    };
    const map = {
        transportoPriemonesLimit: "regitra",
        teismoNuosprendziaiLimit: "teismoNuosprendziai",
        sutartysLimit: "sutartys",
        darboSkelbimaiLimit: "darboSkelbimai",
        rcPranesimaiLimit: "rcPranesimai",
        domenaiLimit: "domenai",
        pinregLimit: "pinreg",
        kotisLimit: "kotis",
        esInvesticijosLimit: "esInvesticijos",
        mvpAprasaiLimit: "mvpAprasai",
    };

    return Object.fromEntries(
        Object.entries(map).map(([queryKey, key]) => {
            const val = query[queryKey];
            if (val === "max") return [key, { limit: null }];
            if (val !== undefined)
                return [
                    key,
                    {
                        limit: Number.isNaN(Number(val))
                            ? defaults[key]
                            : Number(val),
                    },
                ];
            return [key, { limit: defaults[key] }];
        }),
    );
}

function buildAprasas(asmuo) {
    let aprasas = `${asmuo.jar.pavadinimas} (${asmuo.jar.jarKodas})`;
    if (asmuo.jar?.adresas) aprasas += `\nAdresas: ${asmuo.jar.adresas}`;
    if (asmuo.sodra?.numInsured) {
        aprasas += `\nSodra: ${asmuo.sodra.numInsured} darbuotojų`;
        if (asmuo.sodra.avgWage)
            aprasas += `, vidutinis atlyginimas: ${asmuo.sodra.avgWage.toFixed(2)} €/mėn.`;
    }
    return aprasas;
}

asmuoRouter.get("/asmuo/:jarKodas", async (req, res, next) => {
    if (!/^\d{1,9}(\.json|\.png)?$/.test(req.params.jarKodas)) return next();

    const { jarKodas, format } = parseJarKodas(req.params.jarKodas);
    const juridinioInfo = await getJuridinisInfo(
        jarKodas,
        parseLimitai(req.query),
    );

    if (juridinioInfo.special) {
        return res.render("juridiniai/netikrasAsmuo", {
            customHead: config.customHead,
            asmuo: { id: jarKodas },
            pavadinimas: juridinioInfo.pavadinimas,
            aprasymas: juridinioInfo.aprasymas,
        });
    }
    if (juridinioInfo.error === 404) return next();

    const { asmuo, timings } = juridinioInfo;
    res.setHeader("Server-Timing", timings.serverTiming());

    if (format === "json") {
        res.setHeader("Content-Type", "application/json");
        return res.send(JSON.stringify(asmuo, null, 2));
    }

    if (format === "png") {
        const subtitle = asmuo.jar.pavadinimas
            .replace(asmuo.jar.formosPavadinimas || "", "")
            .replaceAll(`"`, "");
        return await serveOpenGraphImage(
            res,
            asmuo.jar.formosPavadinimas || "Juridinis asmuo",
            subtitle,
            `Registruotas: ${asmuo.jar.registravimoData}<br>
            Adresas: ${asmuo.jar.adresas}<br>
            Vid. atlyginimas ${asmuo.sodra?.vidutinisAtlyginimas || "nežinomas"} (€/mėn)<br>
            Dirba ${asmuo.sodra?.draustieji || "nežinomas skaičius"} darb.`,
            `viespirkiai.org/asmuo/${asmuo.jar.jarKodas}`,
        );
    }

    res.set("Cache-Control", "private, max-age=7200, s-maxage=7200");
    return res.render("juridiniai/asmuo", {
        asmuo,
        customHead: config.customHead,
        aprasas: buildAprasas(asmuo),
        queryParams: req.query,
    });
});

function serveAsData(res, data, { jarKodas, slug, format }) {
    const filename = `${slug}-${jarKodas}.${format}`;
    if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`,
        );
        objectsToCSV(data).pipe(res);
    } else {
        res.setHeader("Content-Type", "application/jsonl; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`,
        );
        objectsToJsonlStream(data).pipe(res);
    }
}

for (const { paths, slug, dataKey } of [
    {
        paths: ["topPirkejai.csv", "topPirkejai.jsonl"],
        slug: "top-pirkejai",
        dataKey: "topPirkejai",
    },
    {
        paths: ["topTiekejai.csv", "topTiekejai.jsonl"],
        slug: "top-tiekejai",
        dataKey: "topTiekejai",
    },
]) {
    asmuoRouter.get(
        paths.map((p) => `/asmuo/:jarKodas/sutartys/${p}`),
        async (req, res, next) => {
            if (!/^\d{1,9}$/.test(req.params.jarKodas)) return next();
            const sutartys = await gautiSutarciuDuomenisPagalJarKoda(
                req.params.jarKodas,
            );
            if (!sutartys) return next();
            const format = req.path.endsWith(".csv")
                ? "csv"
                : req.path.endsWith(".jsonl")
                  ? "jsonl"
                  : null;
            if (!format) return next();
            serveAsData(res, sutartys[dataKey] ?? [], {
                jarKodas: req.params.jarKodas,
                slug,
                format,
            });
        },
    );
}

export default asmuoRouter;
