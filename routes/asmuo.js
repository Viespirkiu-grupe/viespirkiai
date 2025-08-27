import express from "express";
import config from "../utils/config.js";
import { mysql } from "../mysql/mysql.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { viespirkiai } from "../mongo/mongoDb.js";
import { postgres } from "../postgres/postgres.js";

const asmuoRouter = express.Router();

asmuoRouter.get("/asmuo/:id", async (req, res, next) => {
    let { id } = req.params;

    if (id.endsWith(".json")) {
        id = id.slice(0, -5);
    }
    if (id.endsWith(".png")) {
        id = id.slice(0, -4);
    }

    // JAR
    const [jarRezultatai] = await mysql.execute(
        "SELECT * FROM jar WHERE jarKodas = ?;",
        [id],
    );

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
    jar.registravimoData = jar.registravimoData.toLtDate();
    jar.duomenuData = jar.duomenuData.toLtDate();
    jar.statusasNuo = jar.statusasNuo.toLtDate();

    // Adreso koordinatės
    if (jar.adresoId && jar.adresoId > 0) {
        const [adresasRezultatai] = await mysql.execute(
            "SELECT * FROM adresai WHERE id = ?;",
            [jar.adresoId],
        );
        if (adresasRezultatai.length > 0) {
            jar.koordinates = adresasRezultatai[0].taskas;
        }
        delete jar.adresoId;
    }

    // SODRA
    const [sodraRezultatai] = await mysql.execute(
        "SELECT * FROM sodra WHERE jarKodas = ? ORDER BY data ASC;",
        [id],
    );

    let sodra;
    if (sodraRezultatai.length > 0) {
        const pirmas = sodraRezultatai.at(-1);

        const formatDate = (date) =>
            `${date}`.slice(0, 4) + "-" + `${date}`.slice(4, 6);

        const naudojamiNaujausi = [
            "kodas",
            "jarKodas",
            "pavadinimas",
            "savivaldybe",
            "ekonominesVeiklosKodas",
            "ekonominesVeiklosPavadinimas",
            "vidutinisAtlyginimas",
            "vidutinisAtlyginimas2",
            "draustieji",
            "draustieji2",
            "imokuSuma",
        ];

        sodra = Object.fromEntries(
            naudojamiNaujausi.map((key) => [key, pirmas[key]]),
        );

        sodra.data = formatDate(pirmas.data);

        sodra.bendrasDraustujuSkaicius = pirmas.draustieji + pirmas.draustieji2;

        sodra.bendrasVidutinisAtlyginimas =
            (pirmas.vidutinisAtlyginimas * pirmas.draustieji +
                pirmas.vidutinisAtlyginimas2 * pirmas.draustieji2) /
            sodra.bendrasDraustujuSkaicius;

        sodra.atlyginimuIslaidos = parseFloat(
            (
                sodra.bendrasVidutinisAtlyginimas *
                sodra.bendrasDraustujuSkaicius
            ).toFixed(2),
        );

        sodra.duomenys = sodraRezultatai.map((row) => ({
            data: formatDate(row.data),
            vidutinisAtlyginimas: row.vidutinisAtlyginimas,
            draustieji: row.draustieji,
            vidutinisAtlyginimas2: row.vidutinisAtlyginimas2,
            draustieji2: row.draustieji2,
            imokuSuma: row.imokuSuma,
        }));
    }

    // VMI
    const [mokesciaiRezultatai] = await mysql.execute(
        "SELECT * FROM mokesciai WHERE jarKodas = ? ORDER BY metai ASC, menuo ASC;",
        [id],
    );

    let mokesciai;

    if (mokesciaiRezultatai.length > 0) {
        const naujausias = mokesciaiRezultatai.at(-1);

        const naudojamiNaujausi = [
            "pavadinimas",
            "jarKodas",
            "formosPavadinimas",
            "suma",
        ];

        mokesciai = {
            ...Object.fromEntries(
                naudojamiNaujausi.map((key) => [key, naujausias[key]]),
            ),
            data: `${naujausias.metai}-${naujausias.menuo
                .toString()
                .padStart(2, "0")}`,
            duomenuData: naujausias.duomenuData.toLtDate(),

            duomenys: mokesciaiRezultatai.map((row) => ({
                data: `${row.metai}-${row.menuo.toString().padStart(2, "0")}`,
                duomenuData: row.duomenuData.toLtDate(),
                suma: row.suma,
            })),
        };
    }

    let regitra = [];
    const [regitraRezultatai] = await mysql.execute(
        "SELECT * FROM regitra WHERE jarKodas = ? ORDER BY pirmosiosRegistracijosData ASC;",
        [id],
    );

    regitra = regitraRezultatai;

    let teismoNuosprendziai = [];
    const [teismoNuosprendziaiRezultatai] = await mysql.execute(
        `SELECT b.*, bd.*
        FROM bylos b
        JOIN bylosDalyviai bd ON bd.bylosId = b.id
        WHERE bd.kodas = ?
        ORDER BY b.data DESC;`,
        [id],
    );

    teismoNuosprendziai = teismoNuosprendziaiRezultatai;

    // Formatuojame teismo nuosprendžius
    teismoNuosprendziai = teismoNuosprendziai.map((nuosprendis) => {
        return {
            ...nuosprendis,
            // bylojeKaip	rašyti iš didžiosios
            bylojeKaip: nuosprendis.bylojeKaip
                ? nuosprendis.bylojeKaip.charAt(0).toUpperCase() +
                  nuosprendis.bylojeKaip.slice(1)
                : "",
            bylosRusis: nuosprendis.bylosRusis
                ? nuosprendis.bylosRusis.charAt(0).toUpperCase() +
                  nuosprendis.bylosRusis.slice(1)
                : "",
        };
    });

    let sutartys = {
        pirkejas: [],
        tiekejas: [],
    };

    let pirkimaiCursor = viespirkiai.find({
        perkanciosiosOrganizacijosKodas: String(id),
    });

    sutartys.pirkejas = await pirkimaiCursor.toArray();

    let tiekimaiCursor = viespirkiai.find({
        tiekejoKodas: String(id),
    });

    sutartys.tiekejas = await tiekimaiCursor.toArray();

    function getYearlyTotals(contracts) {
        const totals = {};
        contracts.forEach((c) => {
            if (c.tipas === "SP") return; // skip SP contracts
            const year = new Date(c.sudarymoData).getFullYear();
            if (!totals[year]) totals[year] = 0;
            totals[year] += c.verte || 0;
        });
        // Convert to array of objects sorted by year, rounding totals
        return Object.entries(totals)
            .map(([year, total]) => ({
                year: Number(year),
                total: Math.round(total * 100) / 100,
            }))
            .sort((a, b) => a.year - b.year);
    }

    function getTop10ByjarKodas(contracts, jarKodasField) {
        const sums = {};
        contracts.forEach((c) => {
            if (c.tipas === "SP") return; // skip SP contracts
            const jarKodas = c[jarKodasField];
            if (!sums[jarKodas]) sums[jarKodas] = 0;
            sums[jarKodas] += c.verte || 0;
        });
        // Convert to array of { jarKodas, total }, round totals, sort descending
        return Object.entries(sums)
            .map(([jarKodas, total]) => ({
                jarKodas,
                total: Math.round(total * 100) / 100,
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);
    }

    // Usage with your data:
    const pirkimaiKasMetus = getYearlyTotals(sutartys.pirkejas);
    const tiekimaiKasMetus = getYearlyTotals(sutartys.tiekejas);

    const topTiekejai = getTop10ByjarKodas(sutartys.pirkejas, "tiekejoKodas");
    const topPirkejai = getTop10ByjarKodas(
        sutartys.tiekejas,
        "perkanciosiosOrganizacijosKodas",
    );

    for (let topTiekejoId in topTiekejai) {
        if (specAtvejai[topTiekejai[topTiekejoId].jarKodas]) {
            topTiekejai[topTiekejoId].pavadinimas =
                specAtvejai[topTiekejai[topTiekejoId].jarKodas].pavadinimas;
            continue;
        }
        const [jarTiekejoRezultatai] = await mysql.execute(
            "SELECT * FROM jar WHERE jarKodas = ?;",
            [topTiekejai[topTiekejoId].jarKodas],
        );
        if (jarTiekejoRezultatai.length > 0) {
            topTiekejai[topTiekejoId].pavadinimas =
                jarTiekejoRezultatai[0].pavadinimas;
        } else {
            topTiekejai[topTiekejoId].pavadinimas = "Nežinomas";
        }
    }

    for (let topPirkejoId in topPirkejai) {
        if (specAtvejai[topPirkejai[topPirkejoId].jarKodas]) {
            topPirkejai[topPirkejoId].pavadinimas =
                specAtvejai[topPirkejai[topPirkejoId].jarKodas].pavadinimas;
            continue;
        }
        const [jarPirkejoRezultatai] = await mysql.execute(
            "SELECT * FROM jar WHERE jarKodas = ?;",
            [topPirkejai[topPirkejoId].jarKodas],
        );
        if (jarPirkejoRezultatai.length > 0) {
            topPirkejai[topPirkejoId].pavadinimas =
                jarPirkejoRezultatai[0].pavadinimas;
        } else {
            topPirkejai[topPirkejoId].pavadinimas = "Nežinomas";
        }
    }

    // Finansinės ataskaitos
    let finansai = {};

    const jarRes = await postgres.query(
        `SELECT "id" FROM "jar" WHERE "jarKodas" = $1`,
        [id],
    );

    if (jarRes.rows && jarRes.rows.length > 0) {
        const jarId = jarRes.rows[0].id;

        const balansoRes = await postgres.query(
            `SELECT *
                 FROM "balansoAtaskaitos"
                 WHERE "jarId" = $1
                 ORDER BY "laikotarpisNuo" DESC, "lineTypeId" ASC`,
            [jarId],
        );

        if (balansoRes.rows && balansoRes.rows.length > 0) {
            finansai.balansai = balansoRes.rows;
        }

        const pelnoNuostoliuRes = await postgres.query(
            `SELECT *
                 FROM "pelnoNuostoliuAtaskaitos"
                 WHERE "jarId" = $1
                 ORDER BY "laikotarpisNuo" DESC, "lineTypeId" ASC`,
            [jarId],
        );

        if (pelnoNuostoliuRes.rows && pelnoNuostoliuRes.rows.length > 0) {
            finansai.pelnasNuostoliai = pelnoNuostoliuRes.rows;
        }

        const sentenceCase = (text) =>
            text
                .replace(/([^.!?]*[.!?]*)/g, (sentence) =>
                    sentence.trim()
                        ? sentence.trim().charAt(0).toUpperCase() +
                          sentence.trim().slice(1).toLowerCase() +
                          " "
                        : "",
                )
                .trim();

        const grouped = {};

        // iterate both types
        for (const type of ["balansai", "pelnasNuostoliai"]) {
            for (const entry of finansai?.[type] || []) {
                // key by period + submission date + template
                const key = `${entry.laikotarpisNuo}_${entry.laikotarpisIki}_${entry.duomenuData}_${entry.templateId}`;

                // create or overwrite period object
                grouped[key] = grouped[key] || {
                    laikotarpisNuo: entry.laikotarpisNuo,
                    laikotarpisIki: entry.laikotarpisIki,
                    duomenuData: entry.duomenuData,
                    templateId: entry.templateId,
                    templateName: sentenceCase(entry.templateName),
                    standards: {},
                };

                // ensure standard object exists
                const standards = grouped[key].standards;
                standards[entry.standardId] = standards[entry.standardId] || {
                    standardId: entry.standardId,
                    standardName: sentenceCase(entry.standardName),
                    lines: [],
                };

                // push only relevant fields
                standards[entry.standardId].lines.push({
                    lineTypeId: entry.lineTypeId,
                    lineName: sentenceCase(entry.lineName),
                    reiksme: entry.reiksme,
                });
            }
        }

        finansai = Object.values(grouped).map((period) => ({
            ...period,
            standards: Object.values(period.standards),
        }));
    }

    // Asmuo
    let asmuo = {
        jar,
        sodra,
        mokesciai,
        regitra,
        teismoNuosprendziai,
        sutartys: {
            pirkimaiKasMetus,
            tiekimaiKasMetus,
            topPirkejai,
            topTiekejai,
        },
        finansai,
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
