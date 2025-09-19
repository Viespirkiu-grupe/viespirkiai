import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";
import { gautiAdresoKoordinatesPagalId } from "./asmuoDalys/adresai.js";
import { gautiSodrosDuomenis } from "./asmuoDalys/sodra.js";
import { gautiVmiDuomenis } from "./asmuoDalys/vmi.js";
import { gautiRegitrosDuomenis } from "./asmuoDalys/regitra.js";
import { gautiTeismoNuosprendzius } from "./asmuoDalys/teismoNuosprendziai.js";
import { gautiSutarciuDuomenis } from "./asmuoDalys/sutartys.js";
import { gautiFinansuDuomenis } from "./asmuoDalys/finansai.js";
import { gautiIstatiniKapitala } from "./asmuoDalys/istatinisKapitalas.js";
import { gautiDarboSkelbimus } from "./asmuoDalys/darboSkelbimai.js";
import { gautiDarboGrafikaPagalSutarciuRedagavima } from "./asmuoDalys/darboGrafikas.js";
import Timings from "../utils/timings.js";

const asmuoRouter = express.Router();

asmuoRouter.get("/asmuo/:id", async (req, res, next) => {
    // Id turi būti <=9 skaitmenys, jei ne – 404
    if (!/^\d{1,9}(\.json|\.png)?$/.test(req.params.id)) {
        return next();
    }

    let timings = new Timings();

    let { id } = req.params;

    if (id.endsWith(".json")) {
        id = id.slice(0, -5);
    }
    if (id.endsWith(".png")) {
        id = id.slice(0, -4);
    }

    timings.start("jar");
    // Detalus JAR
    const { rows: jarRezultatai } = await postgres.query(
        `SELECT * FROM "jarCsv" WHERE "jarKodas" = $1`,
        [id],
    );
    timings.end("jar");

    // data.gov.lt ID JAR
    let jarId;

    timings.start("jarCsv");
    const jarRes = await postgres.query(
        `SELECT "id" FROM "jar" WHERE "jarKodas" = $1`,
        [id],
    );
    timings.end("jarCsv");

    if (jarRes.rows && jarRes.rows.length > 0) {
        jarId = jarRes.rows[0].id;
    }

    // Specialūs atvejai
    const specAtvejai = {
        801: {
            pavadinimas: "CVP IS pilietis",
            aprasymas:
                "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas piliečiui.",
        },
        802: {
            pavadinimas: "CVP IS ūkininkas",
            aprasymas:
                "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas ūkininkui.",
        },
        803: {
            pavadinimas: "CVP IS užsienio įmonė",
            aprasymas:
                "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas užsienio įmonei.",
        },
        804: {
            pavadinimas: "CVP IS Lietuvos respublikos ambasada",
            aprasymas:
                "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas Lietuvos respublikos ambasadai.",
        },
        807: {
            pavadinimas: "CVP IS kitas asmuo",
            aprasymas:
                "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas kitam asmeniui.",
        },
        808: {
            pavadinimas: "CVP IS Europos komisijos atstovybė Lietuvoje",
            aprasymas:
                "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas Europos komisijos atstovybei Lietuvoje.",
        },
        809: {
            pavadinimas: "CVP IS fizinis asmuo",
            aprasymas:
                "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas fiziniam asmeniui.",
        },
    };

    if (specAtvejai[id]) {
        const { pavadinimas, aprasymas } = specAtvejai[id];
        res.render("juridiniai/netikrasAsmuo", {
            customHead: config.customHead,
            asmuo: { id },
            pavadinimas,
            aprasymas,
        });
        return;
    }

    // 404
    if (jarRezultatai.length === 0) {
        return next();
    }

    // Formatuojame JAR datas
    let jar = jarRezultatai[0];
    jar.registravimoData = new Date(jar.registravimoData).toLtDate();
    jar.duomenuData = new Date(jar.duomenuData).toLtDate();
    jar.statusasNuo = new Date(jar.statusasNuo).toLtDate();

    const taskMap = {
        adresai: async () => {
            if (jar.adresoId && jar.adresoId > 0) {
                jar.koordinates = await gautiAdresoKoordinatesPagalId(
                    jar.adresoId,
                );
            }
            delete jar.adresoId;
        },
        sodra: async () => gautiSodrosDuomenis(id),
        vmi: async () => gautiVmiDuomenis(id),
        regitra: async () => gautiRegitrosDuomenis(req, id),
        teismoNuosprendziai: async () => gautiTeismoNuosprendzius(req, id),
        sutartys: async () => gautiSutarciuDuomenis(id),
        finansai: async () => gautiFinansuDuomenis(jarId),
        istatinisKapitalas: async () => gautiIstatiniKapitala(jarId),
        darboSkelbimai: async () => gautiDarboSkelbimus(req, id),
        darboGrafikas: async () => gautiDarboGrafikaPagalSutarciuRedagavima(id),
    };

    // Run all tasks in parallel with timings
    const timedTasks = Object.fromEntries(
        Object.entries(taskMap).map(([key, fn]) => [
            key,
            (async () => {
                timings.start(key);
                const result = await fn();
                timings.end(key);
                return result;
            })(),
        ]),
    );

    const results = await Promise.allSettled(Object.values(timedTasks));

    // Map results back to keys cleanly
    const data = Object.fromEntries(
        Object.keys(timedTasks).map((key, i) => [
            key,
            results[i].status === "fulfilled" ? results[i].value : null,
        ]),
    );

    res.setHeader("Server-Timing", timings.serverTiming());

    // Asmuo
    let asmuo = {
        jar,
        ...data,
    };

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
            `viespirkiai.top/asmuo/${asmuo.jar.jarKodas}`,
        );
    }

    // Aprašas
    let aprasas = `${jar.pavadinimas} (${jar.jarKodas})`;

    // Adresas
    if (asmuo?.jar?.adresas) {
        aprasas += `\nAdresas: ${jar.adresas}`;
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

export default asmuoRouter;
