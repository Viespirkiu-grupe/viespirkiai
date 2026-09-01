import { postgres } from "../../postgres/postgres.js";

/**
 * Rašymas į `uzt` schemą. Žodynų reikšmės sprendžiamos pačiame SQL (INSERT …
 * ON CONFLICT CTE viduje + UNION ALL su ką tik įrašytomis eilutėmis), todėl
 * jokio kešo procese nereikia ir keli rašytojai vienas kitam netrukdo.
 */

/** Šaltinio laukai eilutės objekte -> unnest() parametrų tvarka ir tipai. */
const LAUKAI = [
    ["_id", "uuid"], ["_revision", "uuid"], ["darboVietosId", "text"],
    ["statusas", "text"], ["valiuta", "text"], ["savivaldybe", "text"],
    ["registravimoPagrindas", "text"], ["registravimoBudas", "text"],
    ["pageidavimoBudas", "text"], ["susisiekimoBudas", "text"],
    ["rizikos", "text"], ["gebejimai", "text"], ["issilavinimas", "text"],
    ["mokymoPrograma", "text"], ["kontraktoTipas", "text"],
    ["profesija", "text"], ["profesijosKodas", "text"],
    ["profesijuGrupe", "text"], ["profesijuGrupesKodas", "text"],
    ["ikelimoData", "date"], ["galiojaNuo", "date"], ["galiojaIki", "date"],
    ["pageidaujamaDarboPradzia", "date"],
    ["prelimDarboUzmokestis", "numeric"], ["vidDarboUzmokestis", "numeric"],
    ["maksDarboUzmokestis", "numeric"], ["uzmokescioKomentaras", "text"],
    ["darboAprasymas", "text"], ["darboVietuSkaicius", "smallint"],
    ["darboVietosAdresas", "text"], ["reikDarboPatirtis", "smallint"],
    ["reikKompetencijos", "text"], ["darbdavioKontaktinisAsmuo", "text"],
    ["darbdavioTelNr", "text"], ["darbdavioMobNr", "text"],
    ["darbdavioElPastas", "text"],
    ["arAktualiSiandien", "boolean"], ["arUzpildyta", "boolean"],
    ["arPapildomaiRemia", "boolean"], ["arDarbinaPoMokymu", "boolean"],
    ["arApmokaKeliones", "boolean"], ["arApgyvendina", "boolean"],
    ["arMaitina", "boolean"], ["arMoksleiviams", "boolean"],
    ["arIki18", "boolean"], ["arStudentams", "boolean"],
    ["arKariams", "boolean"], ["arUkrainieciams", "boolean"],
    ["arTurintiemsNegalia", "boolean"],
    ["jarKodas", "text"], ["darbdavys", "text"], ["teisinisStatusas", "text"],
    ["teisineForma", "text"], ["darbdavioBustine", "text"],
    ["imonesIregistravimas", "date"],
];

/** Paprasti žodynai: [lentelė, eilutės laukas, pagrindinis stulpelis]. */
const ZODYNAI = [
    ["statusai", "statusas", "statusoId"],
    ["valiutos", "valiuta", "valiutosId"],
    ["savivaldybes", "savivaldybe", "savivaldybesId"],
    ["registravimoPagrindai", "registravimoPagrindas", "registravimoPagrindoId"],
    ["registravimoBudai", "registravimoBudas", "registravimoBudoId"],
    ["pageidavimoBudai", "pageidavimoBudas", "pageidavimoBudoId"],
    ["issilavinimai", "issilavinimas", "issilavinimoId"],
    ["mokymoProgramos", "mokymoPrograma", "mokymoProgramosId"],
    ["kontraktuTipai", "kontraktoTipas", "kontraktoTipoId"],
    ["rizikos", "rizikos", "rizikosId"],
    ["gebejimai", "gebejimai", "gebejimuId"],
];

const INCOMING = `SELECT * FROM unnest(${LAUKAI.map(([, t], i) => `$${i + 1}::${t}[]`).join(", ")})
        AS x(${LAUKAI.map(([r]) => `"${r}"`).join(", ")})`;

/** Naujų žodyno reikšmių įrašymas (grąžina tik ką sukurtas eilutes). */
const zodynoInsert = ([lentele, laukas]) => `ins_${lentele} AS (
        INSERT INTO "uzt"."${lentele}" ("pavadinimas")
        SELECT DISTINCT "${laukas}" FROM incoming WHERE "${laukas}" IS NOT NULL
        ON CONFLICT ("pavadinimas") DO NOTHING RETURNING "id", "pavadinimas"
    )`;

/** Žodyno id: arba jau buvusi eilutė, arba ką tik šiame sakinyje įrašytoji. */
const zodynoId = (lentele, israiska) => `(
        SELECT "id" FROM "uzt"."${lentele}" WHERE "pavadinimas" = ${israiska}
        UNION ALL
        SELECT "id" FROM ins_${lentele} WHERE "pavadinimas" = ${israiska}
        LIMIT 1)`;

const DARBDAVIU_SQL = `
    WITH incoming AS (${INCOMING}),
    ${zodynoInsert(["teisiniaiStatusai", "teisinisStatusas"])},
    ${zodynoInsert(["teisinesFormos", "teisineForma"])}
    INSERT INTO "uzt"."darbdaviai" AS d (
        "jarKodas", "pavadinimas", "teisinioStatusoId", "teisinesFormosId",
        "bustine", "imonesIregistravimas"
    )
    SELECT DISTINCT ON (i."jarKodas")
        i."jarKodas", i."darbdavys",
        ${zodynoId("teisiniaiStatusai", 'i."teisinisStatusas"')},
        ${zodynoId("teisinesFormos", 'i."teisineForma"')},
        i."darbdavioBustine", i."imonesIregistravimas"
    FROM incoming i
    WHERE i."jarKodas" IS NOT NULL
    ORDER BY i."jarKodas", i."ikelimoData" DESC NULLS LAST
    ON CONFLICT ("jarKodas") DO UPDATE SET
        "pavadinimas"          = COALESCE(EXCLUDED."pavadinimas", d."pavadinimas"),
        "teisinioStatusoId"    = COALESCE(EXCLUDED."teisinioStatusoId", d."teisinioStatusoId"),
        "teisinesFormosId"     = COALESCE(EXCLUDED."teisinesFormosId", d."teisinesFormosId"),
        "bustine"              = COALESCE(EXCLUDED."bustine", d."bustine"),
        "imonesIregistravimas" = COALESCE(EXCLUDED."imonesIregistravimas", d."imonesIregistravimas")`;

const STULPELIAI = [
    "_id", "_revision", "darboVietosId", "jarKodas", "profesijosId",
    ...ZODYNAI.map(([, , stulpelis]) => stulpelis),
    "susisiekimoBuduIds", "ikelimoData", "galiojaNuo", "galiojaIki",
    "pageidaujamaDarboPradzia", "prelimDarboUzmokestis", "vidDarboUzmokestis",
    "maksDarboUzmokestis", "uzmokescioKomentaras", "darboAprasymas",
    "darboVietuSkaicius", "darboVietosAdresas", "reikDarboPatirtis",
    "reikKompetencijos", "darbdavioKontaktinisAsmuo", "darbdavioTelNr",
    "darbdavioMobNr", "darbdavioElPastas",
    ...LAUKAI.filter(([, tipas]) => tipas === "boolean").map(([raktas]) => raktas),
];

const DARBO_VIETU_SQL = `
    WITH incoming AS (${INCOMING}),
    ${ZODYNAI.map(zodynoInsert).join(",\n    ")},
    ins_susisiekimoBudai AS (
        INSERT INTO "uzt"."susisiekimoBudai" ("pavadinimas")
        SELECT DISTINCT btrim(v.budas) FROM incoming,
             LATERAL regexp_split_to_table(COALESCE("susisiekimoBudas", ''), ',') AS v(budas)
        WHERE btrim(v.budas) <> ''
        ON CONFLICT ("pavadinimas") DO NOTHING RETURNING "id", "pavadinimas"
    ),
    ins_profesijuGrupes AS (
        INSERT INTO "uzt"."profesijuGrupes" ("pavadinimas", "kodas")
        SELECT DISTINCT ON ("profesijuGrupe") "profesijuGrupe", "profesijuGrupesKodas"
        FROM incoming WHERE "profesijuGrupe" IS NOT NULL
        ORDER BY "profesijuGrupe", "profesijuGrupesKodas" NULLS LAST
        ON CONFLICT ("pavadinimas") DO UPDATE
        SET "kodas" = COALESCE("uzt"."profesijuGrupes"."kodas", EXCLUDED."kodas")
        RETURNING "id", "pavadinimas"
    ),
    ins_profesijos AS (
        INSERT INTO "uzt"."profesijos" ("pavadinimas", "kodas", "grupesId")
        SELECT DISTINCT ON (i."profesija") i."profesija", i."profesijosKodas",
               ${zodynoId("profesijuGrupes", 'i."profesijuGrupe"')}
        FROM incoming i WHERE i."profesija" IS NOT NULL
        ORDER BY i."profesija", i."profesijosKodas" NULLS LAST
        ON CONFLICT ("pavadinimas") DO UPDATE SET
            "kodas"    = COALESCE("uzt"."profesijos"."kodas", EXCLUDED."kodas"),
            "grupesId" = COALESCE("uzt"."profesijos"."grupesId", EXCLUDED."grupesId")
        RETURNING "id", "pavadinimas"
    )
    INSERT INTO "uzt"."darboVietos" AS dv (${STULPELIAI.map((s) => `"${s}"`).join(", ")})
    SELECT
        i."_id", i."_revision", i."darboVietosId", i."jarKodas",
        ${zodynoId("profesijos", 'i."profesija"')},
        ${ZODYNAI.map(([lentele, laukas]) => zodynoId(lentele, `i."${laukas}"`)).join(",\n        ")},
        (SELECT array_agg(b."id" ORDER BY v.ord)
           FROM regexp_split_to_table(i."susisiekimoBudas", ',') WITH ORDINALITY AS v(budas, ord)
           JOIN LATERAL ${zodynoId("susisiekimoBudai", "btrim(v.budas)")} AS b("id") ON true),
        i."ikelimoData", i."galiojaNuo", i."galiojaIki", i."pageidaujamaDarboPradzia",
        i."prelimDarboUzmokestis", i."vidDarboUzmokestis", i."maksDarboUzmokestis",
        i."uzmokescioKomentaras", i."darboAprasymas", i."darboVietuSkaicius",
        i."darboVietosAdresas", i."reikDarboPatirtis", i."reikKompetencijos",
        i."darbdavioKontaktinisAsmuo", i."darbdavioTelNr", i."darbdavioMobNr",
        i."darbdavioElPastas",
        ${LAUKAI.filter(([, t]) => t === "boolean").map(([r]) => `i."${r}"`).join(", ")}
    FROM incoming i
    ON CONFLICT ("_id") DO UPDATE SET
        ${STULPELIAI.filter((s) => s !== "_id")
            .map((s) => `"${s}" = EXCLUDED."${s}"`)
            .join(",\n        ")}
    WHERE dv."_revision" IS DISTINCT FROM EXCLUDED."_revision"`;

/**
 * Įrašo (arba atnaujina) darbo vietų paketą kartu su žodynais ir darbdaviais.
 * Darbdaviai rašomi atskiru sakiniu pirmi – "darboVietos"."jarKodas" turi į
 * juos išorinį raktą.
 * @param {Object[]} eilutes – paruostiEilute() rezultatai
 */
export async function irasytiDarboVietas(eilutes) {
    if (!eilutes.length) return 0;

    const parametrai = LAUKAI.map(([raktas]) => eilutes.map((e) => e[raktas] ?? null));

    if (eilutes.some((e) => e.jarKodas)) {
        await postgres.query(DARBDAVIU_SQL, parametrai);
    }
    const { rowCount } = await postgres.query(DARBO_VIETU_SQL, parametrai);
    return rowCount;
}

/** Laukai, kurie priklauso ne skelbimui, o darbdaviui. */
const DARBDAVIO_LAUKAI = new Set([
    "darbdavys", "teisinisStatusas", "teisineForma",
    "darbdavioBustine", "imonesIregistravimas",
]);

/** Žodyno reikšmės id; jei tokios dar nėra – įrašoma. */
async function zodynoIdReiksmei(lentele, pavadinimas) {
    if (pavadinimas === null || pavadinimas === undefined) return null;
    const { rows } = await postgres.query(
        `INSERT INTO "uzt"."${lentele}" ("pavadinimas") VALUES ($1)
         ON CONFLICT ("pavadinimas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         RETURNING "id"`,
        [pavadinimas],
    );
    return rows[0].id;
}

async function profesijosIdReiksmei(eilute) {
    if (!eilute.profesija) return null;
    let grupesId = null;
    if (eilute.profesijuGrupe) {
        const { rows } = await postgres.query(
            `INSERT INTO "uzt"."profesijuGrupes" ("pavadinimas", "kodas") VALUES ($1, $2)
             ON CONFLICT ("pavadinimas") DO UPDATE
             SET "kodas" = COALESCE("uzt"."profesijuGrupes"."kodas", EXCLUDED."kodas")
             RETURNING "id"`,
            [eilute.profesijuGrupe, eilute.profesijuGrupesKodas],
        );
        grupesId = rows[0].id;
    }
    const { rows } = await postgres.query(
        `INSERT INTO "uzt"."profesijos" ("pavadinimas", "kodas", "grupesId") VALUES ($1, $2, $3)
         ON CONFLICT ("pavadinimas") DO UPDATE SET
             "kodas"    = COALESCE("uzt"."profesijos"."kodas", EXCLUDED."kodas"),
             "grupesId" = COALESCE("uzt"."profesijos"."grupesId", EXCLUDED."grupesId")
         RETURNING "id"`,
        [eilute.profesija, eilute.profesijosKodas, grupesId],
    );
    return rows[0].id;
}

/**
 * ADP `:changes` patch'as: atnaujinami tik tie stulpeliai, kuriuos šaltinis
 * atsiuntė. Žodyninėms reikšmėms id parenkamas (arba sukuriamas) atskirai –
 * patch'ų būna vienetai, tad paketavimas čia nieko neduotų.
 * @param {string} _id
 * @param {Object} eilute – paruostiEilute() rezultatas
 * @param {string[]} paliesti – eilutės laukai, kuriuos šaltinis atsiuntė
 */
export async function atnaujintiDarboVieta(_id, eilute, paliesti) {
    const stulpeliai = [];
    const reiksmes = [];
    const prideti = (stulpelis, reiksme) => {
        stulpeliai.push(`"${stulpelis}" = $${reiksmes.push(reiksme)}`);
    };

    for (const laukas of paliesti) {
        if (DARBDAVIO_LAUKAI.has(laukas)) continue;
        if (["profesijosKodas", "profesijuGrupe", "profesijuGrupesKodas"].includes(laukas)) continue;

        const zodynas = ZODYNAI.find(([, eilutesLaukas]) => eilutesLaukas === laukas);
        if (zodynas) {
            prideti(zodynas[2], await zodynoIdReiksmei(zodynas[0], eilute[laukas]));
        } else if (laukas === "profesija") {
            prideti("profesijosId", await profesijosIdReiksmei(eilute));
        } else if (laukas === "susisiekimoBudas") {
            prideti("susisiekimoBuduIds", await susisiekimoBuduIdai(eilute.susisiekimoBudas));
        } else {
            prideti(laukas, eilute[laukas]);
        }
    }

    if (paliesti.some((l) => DARBDAVIO_LAUKAI.has(l) || l === "jarKodas")) {
        await atnaujintiDarbdavi(_id, eilute, paliesti);
    }
    if (!stulpeliai.length) return 0;

    const { rowCount } = await postgres.query(
        `UPDATE "uzt"."darboVietos" SET ${stulpeliai.join(", ")}
         WHERE "_id" = $${reiksmes.push(_id)}`,
        reiksmes,
    );
    return rowCount;
}

async function susisiekimoBuduIdai(sarasas) {
    if (!sarasas) return null;
    const dalys = String(sarasas).split(",").map((d) => d.trim()).filter(Boolean);
    if (!dalys.length) return null;
    const idai = [];
    for (const dalis of dalys) idai.push(await zodynoIdReiksmei("susisiekimoBudai", dalis));
    return idai;
}

/** Darbdavio rekvizitų patch'as; JAR kodas imamas iš patch'o arba iš skelbimo. */
async function atnaujintiDarbdavi(_id, eilute, paliesti) {
    let jarKodas = eilute.jarKodas;
    if (!jarKodas) {
        const { rows } = await postgres.query(
            `SELECT "jarKodas" FROM "uzt"."darboVietos" WHERE "_id" = $1`,
            [_id],
        );
        jarKodas = rows[0]?.jarKodas;
    }
    if (!jarKodas) return;

    const laukai = {
        pavadinimas: paliesti.includes("darbdavys") ? eilute.darbdavys : undefined,
        teisinioStatusoId: paliesti.includes("teisinisStatusas")
            ? await zodynoIdReiksmei("teisiniaiStatusai", eilute.teisinisStatusas) : undefined,
        teisinesFormosId: paliesti.includes("teisineForma")
            ? await zodynoIdReiksmei("teisinesFormos", eilute.teisineForma) : undefined,
        bustine: paliesti.includes("darbdavioBustine") ? eilute.darbdavioBustine : undefined,
        imonesIregistravimas: paliesti.includes("imonesIregistravimas")
            ? eilute.imonesIregistravimas : undefined,
    };
    const nurodyti = Object.keys(laukai).filter((l) => laukai[l] !== undefined);
    const stulpeliai = ['"jarKodas"', ...nurodyti.map((l) => `"${l}"`)];

    await postgres.query(
        `INSERT INTO "uzt"."darbdaviai" (${stulpeliai.join(", ")})
         VALUES (${stulpeliai.map((_, i) => `$${i + 1}`).join(", ")})
         ON CONFLICT ("jarKodas") DO UPDATE SET
             ${nurodyti.map((l) => `"${l}" = EXCLUDED."${l}"`).join(", ") || '"jarKodas" = EXCLUDED."jarKodas"'}`,
        [jarKodas, ...nurodyti.map((l) => laukai[l])],
    );
}
