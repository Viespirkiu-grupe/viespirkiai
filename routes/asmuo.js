import express from "express";
import config from "../utils/config.js";
import { mysql } from "../mysql/mysql.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

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
        "SELECT * FROM sodra WHERE jarKodas = ? ORDER BY data DESC;",
        [id],
    );

    let sodra;
    if (sodraRezultatai.length > 0) {
        const [pirmas] = sodraRezultatai;

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
        "SELECT * FROM mokesciai WHERE jarKodas = ? ORDER BY metai DESC, menuo DESC;",
        [id],
    );

    let mokesciai;

    if (mokesciaiRezultatai.length > 0) {
        const naujausias = mokesciaiRezultatai[0];

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

    // Asmuo
    let asmuo = {
        jar,
        sodra,
        mokesciai,
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
            Vid. atlyginimas ${asmuo.sodra.vidutinisAtlyginimas || "nežinomas"} (€/mėn)<br>
            Dirba ${asmuo.sodra.draustieji || "nežinomas skaičius"} darb.`,
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
    });
});

export default asmuoRouter;
