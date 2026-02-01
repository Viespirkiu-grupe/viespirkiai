import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { gautiSutarciuDuomenisPagalJarKoda } from "../modules/sutartys/pagalJarKoda.js";
import { getJuridinisInfo } from "../modules/juridiniai/getJuridinisInfo.js";

const asmuoRouter = express.Router();

asmuoRouter.get("/asmuo/:jarKodas", async (req, res, next) => {
    // Id turi būti <=9 skaitmenys, jei ne – 404
    if (!/^\d{1,9}(\.json|\.png)?$/.test(req.params.jarKodas)) {
        return next();
    }

    let { jarKodas } = req.params;

    if (jarKodas.endsWith(".json")) {
        jarKodas = jarKodas.slice(0, -5);
    }
    if (jarKodas.endsWith(".png")) {
        jarKodas = jarKodas.slice(0, -4);
    }

    let limitai;
    if (req.query.limitai == "false") {
        limitai = {};
    } else {
        limitai = {
            regitra: {
                limit: req.query.regitraLimit || 5,
            },
            teismoNuosprendziai: {
                limit: req.query.teismoNuosprendziaiLimit || 10,
            },
            sutartys: {
                limit: req.query.sutartysLimit || 10,
            },
            darboSkelbimai: {
                limit: req.query.darboSkelbimaiLimit || 5,
            },
            rcPranesimai: {
                limit: req.query.rcPranesimaiLimit || 3,
            },
            domenai: {
                limit: req.query.domenaiLimit || 3,
            },
            pinreg: {
                limit: req.query.pinregLimit || 3,
            },
        };

        let keys = [
            "regitraLimit",
            "teismoNuosprendziaiLimit",
            "sutartysLimit",
            "darboSkelbimaiLimit",
            "rcPranesimaiLimit",
            "domenaiLimit",
            "pinregLimit",
        ];
        // Remove limits for keys set to 'max'
        for (let key of keys) {
            if (req.query[key] == "max") {
                let limitKey = key.replace("Limit", "");
                limitai[limitKey] = { limit: null };
            }
        }
    }

    let juridinioInfo = await getJuridinisInfo(jarKodas, limitai);
    if (juridinioInfo.special) {
        return res.render("juridiniai/netikrasAsmuo", {
            customHead: config.customHead,
            asmuo: { id: jarKodas },
            pavadinimas: juridinioInfo.pavadinimas,
            aprasymas: juridinioInfo.aprasymas,
        });
    } else if (juridinioInfo.error == 404) {
        return next();
    }

    let asmuo = juridinioInfo.asmuo;
    let timings = juridinioInfo.timings;

    res.setHeader("Server-Timing", timings.serverTiming());

    // JSON
    if (req.path.endsWith(".json")) {
        const formattedJson = JSON.stringify(asmuo, null, 2);
        res.setHeader("Content-Type", "application/json");
        return res.send(formattedJson);
    }

    if (req.path.endsWith(".png")) {
        let deduplikuotasPavadinimas = asmuo.jar.pavadinimas
            .replace(asmuo.jar.formosPavadinimas || "", "")
            .replaceAll(`"`, "");

        return await serveOpenGraphImage(
            res,
            asmuo.jar.formosPavadinimas || "Juridinis asmuo",
            deduplikuotasPavadinimas,
            `Registruotas: ${asmuo.jar.registravimoData}<br>
            Adresas: ${asmuo.jar.adresas}<br>
            Vid. atlyginimas ${asmuo?.sodra?.vidutinisAtlyginimas || "nežinomas"} (€/mėn)<br>
            Dirba ${asmuo?.sodra?.draustieji || "nežinomas skaičius"} darb.`,
            `viespirkiai.org/asmuo/${asmuo.jar.jarKodas}`,
        );
    }

    // Aprašas
    let aprasas = `${asmuo.jar.pavadinimas} (${asmuo.jar.jarKodas})`;

    // Adresas
    if (asmuo?.jar?.adresas) {
        aprasas += `\nAdresas: ${asmuo.jar.adresas}`;
    }

    // Darbuotojai, atlyginimai
    if (asmuo?.sodra?.numInsured) {
        aprasas += `\nSodra: ${asmuo.sodra.numInsured} darbuotojų`;
        if (asmuo.sodra.avgWage) {
            aprasas += `, vidutinis atlyginimas: ${asmuo.sodra.avgWage.toFixed(
                2,
            )} €/mėn.`;
        }
    }

    res.set("Cache-Control", "public, max-age=7200, s-maxage=7200");
    res.render("juridiniai/asmuo", {
        asmuo,
        customHead: config.customHead,
        aprasas,
        queryParams: req.query,
    });
});

asmuoRouter.get(
    [
        "/asmuo/:jarKodas/sutartys/topPirkejai.csv",
        "/asmuo/:jarKodas/sutartys/topPirkejai.jsonl",
    ],
    async (req, res, next) => {
        // jarKodas turi būti <=9 skaitmenys, jei ne – 404
        if (!/^\d{1,9}$/.test(req.params.jarKodas)) {
            return next();
        }

        let sutartys = await gautiSutarciuDuomenisPagalJarKoda(
            req.params.jarKodas,
        );

        if (!sutartys) {
            return next();
        }

        if (!sutartys.topPirkejai) {
            sutartys.topPirkejai = [];
        }

        if (req.path.endsWith(".csv")) {
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="top-pirkejai-${req.params.jarKodas}.csv"`,
            );
            // CSV
            let csv = `jarKodas,pavadinimas,suma,kiekis\n`;
            for (let p of sutartys.topPirkejai) {
                csv += `"${p.jarKodas}","${p.pavadinimas.replaceAll(
                    `"`,
                    `""`,
                )}",${p.total},${p.count}\n`;
            }
            return res.send(csv);
        } else if (req.path.endsWith(".jsonl")) {
            res.setHeader("Content-Type", "application/jsonl; charset=utf-8");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="top-pirkejai-${req.params.jarKodas}.jsonl"`,
            );
            // JSONL
            let jsonl = "";
            for (let p of sutartys.topPirkejai) {
                jsonl += JSON.stringify(p) + "\n";
            }
            return res.send(jsonl);
        } else {
            return next();
        }
    },
);

asmuoRouter.get(
    [
        "/asmuo/:jarKodas/sutartys/topTiekejai.csv",
        "/asmuo/:jarKodas/sutartys/topTiekejai.jsonl",
    ],
    async (req, res, next) => {
        // jarKodas turi būti <=9 skaitmenys, jei ne – 404
        if (!/^\d{1,9}$/.test(req.params.jarKodas)) {
            return next();
        }

        let sutartys = await gautiSutarciuDuomenisPagalJarKoda(
            req.params.jarKodas,
        );

        if (!sutartys) {
            return next();
        }

        if (!sutartys.topTiekejai) {
            sutartys.topTiekejai = [];
        }

        if (req.path.endsWith(".csv")) {
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="top-tiekejai-${req.params.jarKodas}.csv"`,
            );
            // CSV
            let csv = `jarKodas,pavadinimas,suma,kiekis\n`;
            for (let p of sutartys.topTiekejai) {
                csv += `"${p.jarKodas}","${p.pavadinimas.replaceAll(
                    `"`,
                    `""`,
                )}",${p.total},${p.count}\n`;
            }
            return res.send(csv);
        } else if (req.path.endsWith(".jsonl")) {
            res.setHeader("Content-Type", "application/jsonl; charset=utf-8");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="top-tiekejai-${req.params.jarKodas}.jsonl"`,
            );
            // JSONL
            let jsonl = "";
            for (let p of sutartys.topTiekejai) {
                jsonl += JSON.stringify(p) + "\n";
            }
            return res.send(jsonl);
        } else {
            return next();
        }
    },
);

export default asmuoRouter;
