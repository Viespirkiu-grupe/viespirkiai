/**
 * VMI sumokėtų mokesčių rašymas į normalizuotą `vmi` schemą.
 *
 * Šaltinio (data.gov.lt `ja_mokesciai/Moketojas`) eilutė plokščia, o DB pusėje
 * pavadinimas, forma, apskritis ir savivaldybė iškelti į žodynus. Tą patį kelią
 * naudoja pilnas importas (`importMoketiMokesciai.js`) ir `:changes` sinchas
 * (`adpSync.js`), tad upsert'as gyvena čia.
 */
import { postgres } from "../../postgres/postgres.js";

/** Šaltinio laukas → reikšmė eilutėje (tvarka sutampa su `IRASYMO_LAUKAI`). */
export function paruostiEilute(obj) {
    return [
        obj._id ?? null,
        obj.id ?? null,
        obj.mm_kodas?._id ?? null, // jarId (= public."jar"._id)
        obj.pavadinimas ?? null,
        obj.tipas ?? null, // formos pavadinimas
        obj.apskritis?._id ?? null,
        obj.savivaldybe?._id ?? null,
        obj.metai ?? null,
        obj.menuo ?? null,
        obj.suma ?? null,
        obj.atnaujinta ?? null, // duomenuData
    ];
}

// Žodynų upsert'ai CTE viduje + faktų eilutės vienu sakiniu; „jau buvo" /
// „ką tik įrašėm" atvejus sutvarko UNION ALL prieš žodyno lentelę.
const UPSERT_SQL = `
    WITH incoming AS (
        SELECT * FROM unnest(
            $1::uuid[], $2::integer[], $3::uuid[], $4::text[],
            $5::text[], $6::uuid[], $7::uuid[], $8::smallint[], $9::smallint[],
            $10::double precision[], $11::date[]
        ) AS x("_id", "id", "jarId", "pavadinimas",
               "forma", "apskritis", "savivaldybe", "metai", "menuo",
               "suma", "duomenuData")
    ), ins_pavadinimai AS (
        INSERT INTO "vmi"."pavadinimai" ("pavadinimas")
        SELECT DISTINCT "pavadinimas" FROM incoming WHERE "pavadinimas" IS NOT NULL
        ON CONFLICT ("pavadinimas") DO NOTHING RETURNING "id", "pavadinimas"
    ), ins_formos AS (
        INSERT INTO "vmi"."formos" ("pavadinimas")
        SELECT DISTINCT "forma" FROM incoming WHERE "forma" IS NOT NULL
        ON CONFLICT ("pavadinimas") DO NOTHING RETURNING "id", "pavadinimas"
    ), ins_apskritys AS (
        INSERT INTO "vmi"."apskritys" ("adpId")
        SELECT DISTINCT "apskritis" FROM incoming WHERE "apskritis" IS NOT NULL
        ON CONFLICT ("adpId") DO NOTHING RETURNING "id", "adpId"
    ), ins_savivaldybes AS (
        INSERT INTO "vmi"."savivaldybes" ("adpId")
        SELECT DISTINCT "savivaldybe" FROM incoming WHERE "savivaldybe" IS NOT NULL
        ON CONFLICT ("adpId") DO NOTHING RETURNING "id", "adpId"
    )
    INSERT INTO "vmi"."mokesciai" AS old (
        "_id", "id", "jarId", "pavadinimoId", "formosId",
        "apskritiesId", "savivaldybesId", "metai", "menuo", "suma", "duomenuData"
    )
    SELECT i."_id", i."id", i."jarId",
           (SELECT "id" FROM "vmi"."pavadinimai" WHERE "pavadinimas" = i."pavadinimas"
             UNION ALL SELECT "id" FROM ins_pavadinimai WHERE "pavadinimas" = i."pavadinimas" LIMIT 1),
           (SELECT "id" FROM "vmi"."formos" WHERE "pavadinimas" = i."forma"
             UNION ALL SELECT "id" FROM ins_formos WHERE "pavadinimas" = i."forma" LIMIT 1),
           (SELECT "id" FROM "vmi"."apskritys" WHERE "adpId" = i."apskritis"
             UNION ALL SELECT "id" FROM ins_apskritys WHERE "adpId" = i."apskritis" LIMIT 1),
           (SELECT "id" FROM "vmi"."savivaldybes" WHERE "adpId" = i."savivaldybe"
             UNION ALL SELECT "id" FROM ins_savivaldybes WHERE "adpId" = i."savivaldybe" LIMIT 1),
           i."metai", i."menuo", i."suma", i."duomenuData"
    FROM incoming i
    ON CONFLICT ("_id") DO UPDATE SET
        "id"             = EXCLUDED."id",
        "jarId"          = EXCLUDED."jarId",
        "pavadinimoId"   = EXCLUDED."pavadinimoId",
        "formosId"       = EXCLUDED."formosId",
        "apskritiesId"   = EXCLUDED."apskritiesId",
        "savivaldybesId" = EXCLUDED."savivaldybesId",
        "metai"          = EXCLUDED."metai",
        "menuo"          = EXCLUDED."menuo",
        "suma"           = EXCLUDED."suma",
        "duomenuData"    = EXCLUDED."duomenuData"
    WHERE ROW(old."jarId", old."metai", old."menuo",
              old."suma", old."duomenuData")
      IS DISTINCT FROM
          ROW(EXCLUDED."jarId", EXCLUDED."metai",
              EXCLUDED."menuo", EXCLUDED."suma", EXCLUDED."duomenuData")
`;

/**
 * Įrašo (arba atnaujina) mokesčių eilutes.
 * @param {Array<Array>} rows - `paruostiEilute` grąžinti masyvai
 */
export async function irasytiMokescius(rows) {
    if (!rows.length) return;
    // unnest() nori stulpelių masyvų, ne eilučių.
    const columns = rows[0].map((_, i) => rows.map((row) => row[i]));
    await postgres.query(UPSERT_SQL, columns);
}

/** Šaltinio laukas → [DB stulpelis, reikšmės ištraukimas iš patch objekto]. */
const PATCH_LAUKAI = {
    id: ["id", (v) => v ?? null],
    "mm_kodas": ["jarId", (v) => v?._id ?? null],
    pavadinimas: ["pavadinimoId", null], // per žodyną
    tipas: ["formosId", null],
    apskritis: ["apskritiesId", null],
    savivaldybe: ["savivaldybesId", null],
    metai: ["metai", (v) => v ?? null],
    menuo: ["menuo", (v) => v ?? null],
    suma: ["suma", (v) => v ?? null],
    atnaujinta: ["duomenuData", (v) => v ?? null],
};

/** Žodyno įrašo id (įrašo, jei tokio dar nėra). */
async function zodynoId(lentele, stulpelis, reiksme) {
    if (reiksme == null) return null;
    await postgres.query(
        `INSERT INTO "vmi"."${lentele}" ("${stulpelis}") VALUES ($1)
         ON CONFLICT ("${stulpelis}") DO NOTHING`,
        [reiksme],
    );
    const { rows } = await postgres.query(
        `SELECT "id" FROM "vmi"."${lentele}" WHERE "${stulpelis}" = $1`,
        [reiksme],
    );
    return rows[0]?.id ?? null;
}

/**
 * Dalinis atnaujinimas iš ADP `:changes` `patch` operacijos: keičiami tik tie
 * stulpeliai, kurie patch'e yra.
 * @param {string} id - šaltinio `_id`
 * @param {Object} patch - šaltinio laukai (nekeisti, su įdėtais objektais)
 */
export async function atnaujintiMokesti(id, patch) {
    const fields = [];
    const values = [];

    for (const [laukas, [stulpelis, imti]] of Object.entries(PATCH_LAUKAI)) {
        if (!(laukas in patch)) continue;
        let reiksme;
        if (imti) {
            reiksme = imti(patch[laukas]);
        } else if (laukas === "pavadinimas") {
            reiksme = await zodynoId("pavadinimai", "pavadinimas", patch[laukas] ?? null);
        } else if (laukas === "tipas") {
            reiksme = await zodynoId("formos", "pavadinimas", patch[laukas] ?? null);
        } else if (laukas === "apskritis") {
            reiksme = await zodynoId("apskritys", "adpId", patch[laukas]?._id ?? null);
        } else {
            reiksme = await zodynoId("savivaldybes", "adpId", patch[laukas]?._id ?? null);
        }
        values.push(reiksme);
        fields.push(`"${stulpelis}" = $${values.length}`);
    }

    if (!fields.length) return;
    values.push(id);
    await postgres.query(
        `UPDATE "vmi"."mokesciai" SET ${fields.join(", ")} WHERE "_id" = $${values.length}`,
        values,
    );
}
