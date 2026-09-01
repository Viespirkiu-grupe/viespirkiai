import crypto from "node:crypto";
import { postgres } from "../../postgres/postgres.js";

// Skaliariniai Keys stulpeliai pagal tipą — atspindi decompose_turinys.sql
// schemą. Rašymo metu konvertuojam result reikšmes taip pat, kaip backfill'e.
const TS_KEYS = [
    "paskelbimoIrArbaKvietimoData",
    "susipazinimoSuPasiulymaisData",
    "laimetojoNustatymoData",
    "dpsGaliojimoDataIrLaikas",
    "kvsGaliojimoDataIrLaikas",
    "pasiulymuArbaParaiskuDalyvautiPirkimePateikimoTerminas",
    "paaiskinimuTerminoPabaiga",
    "prasymuPateiktiPaaiskinimusTerminoPabaiga",
    "kvietimuIssiuntimoTerminas",
    "sutartiesSudarymoData",
    "sutartiesVykdymoPradziosData",
    "preliminariosiosSutartiesTrukme",
];
const NUM_KEYS = ["bendraSutarciuVerte", "suteiktaVertemaksimaliDPSVerte"];
const BOOL_KEYS = [
    "eAukcionuSukurimas",
    "leidziamaPateiktisAlternatyviusPasiulymus",
    "pirkimasSkaidomasIDaliuDPSIKategorijas",
    "pirkimasSkaidomasIKategorijadalisDPSIKategorijas",
    "leistiTiekejamsSistemojePareikstiSusidomejima",
    "dokumentuIkelimasSuPaaiskinimais",
    "galimaPateiktiKelisPasiulymus",
    "laimetojoNustatymasKiekvienamObjektui",
];
const TEXT_KEYS = [
    "nutsKodai",
    "direktyva",
    "pasiulymuVertinimoKriterijai",
    "virsArbaZemiauTarptautinioPirkimoVertesRibos",
    "kontaktinisAsmuo",
    "pirkimuSuvestinesNuoroda",
    "spkKategorija",
    "darboGrupe",
    "skelbimoKalba",
    "pvPirkimoUnikalusID",
    "rinkosKonsultacijosUnikalusID",
    "dpsPVUnikalusID",
    "kvsCEUnikalusID",
    "nuorodaIOLESOficialujiLeidini",
    "skelbiamaOrganizacijosVardu",
    "dalyvaujanciosInstitucijos",
    "neprivalomaPagrindimas",
    "sutartiesTipas",
    "sutartiesTrukmeMenesiaisArbaMetaisIsskyrusPratesimus",
    "pasiulymoGaliojimoTerminasDienomisArbaMenesiais",
    "pasiulymuPateikimoTerminasDienosvalandos",
    "asmenuSusipazistanciuSuPasiulymaisSkaicius",
    "daliuSkaicius",
    "didziausiasDaliuSkaicius",
    "pasiulymaiDelDaliu",
    "kategorijadalisSkaicius",
    "didziausiasKategorijadalisSkaicius",
    "pasiulymaiDelKategorijadalis",
];
const ARRAY_KEYS = ["bvpzKodaiPavadinimai", "tedNuorodosIPaskelbtusPranesimus"];

// Stulpeliai, kurių DB vardas skiriasi nuo result rakto (PG 63 simb. riba).
const SRC_KEY = {
    sutartiesTipas:
        "sutartiesTipasPasirinkusSutartiesTipaJisBusTaikomasVisomsPirkimoDalims",
};

const KEY_COLUMNS = [
    ...TS_KEYS,
    ...NUM_KEYS,
    ...BOOL_KEYS,
    ...TEXT_KEYS,
    ...ARRAY_KEYS,
];

function parseTs(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}${m[4] ? " " + m[4] : ""}`;
    return null;
}

function parseNum(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    let s = String(v).replace(",", ".").replace(/[^0-9.]/g, "");
    s = s.replace(/\.+$/, "").replace(/^\.+/, "");
    return /^[0-9]+(\.[0-9]+)?$/.test(s) ? Number(s) : null;
}

function parseBool(v) {
    if (v === "Taip") return true;
    if (v === "Ne") return false;
    return null;
}

function parseText(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
}

function parseArray(v) {
    return Array.isArray(v) ? v.map((x) => String(x)) : null;
}

function buildKeyValues(result) {
    const values = [];
    for (const k of TS_KEYS) values.push(parseTs(result[k]));
    for (const k of NUM_KEYS) values.push(parseNum(result[k]));
    for (const k of BOOL_KEYS) values.push(parseBool(result[k]));
    for (const k of TEXT_KEYS) values.push(parseText(result[SRC_KEY[k] ?? k]));
    for (const k of ARRAY_KEYS) values.push(parseArray(result[k]));
    return values;
}

// Iš result išrenka dalis (suvienodina numeruotus raktus, daliuPavadinimai ir
// kategorijaDalys masyvus — kaip decompose_turinys.sql backfill'e).
function buildDalys(result) {
    const dalys = [];
    for (const [key, val] of Object.entries(result)) {
        const m = key.match(/^daliuPavadinimas([0-9]+)$/);
        if (m && val != null && String(val).trim() !== "") {
            dalys.push({ rusis: "dalis", numeris: Number(m[1]), pavadinimas: String(val) });
        }
    }
    if (Array.isArray(result.daliuPavadinimai)) {
        result.daliuPavadinimai.forEach((val, i) =>
            dalys.push({ rusis: "dalis", numeris: i + 1, pavadinimas: String(val) }),
        );
    }
    if (Array.isArray(result.kategorijaDalys)) {
        result.kategorijaDalys.forEach((val, i) =>
            dalys.push({ rusis: "kategorijaDalis", numeris: i + 1, pavadinimas: String(val) }),
        );
    }
    return dalys;
}

/**
 * Įrašo pirkimo turinį į reliacines lenteles (Keys/Dalys/Failai/FailuVersijos/
 * Skelbimai). Vaikinės eilutės perrašomos tik pasikeitus turiniui (hash),
 * kad nekintantis 12h perskaitymas nebloatintų lentelių.
 *
 * @param {string} pirkimoId
 * @param {Record<string, any>} result - parserio rezultatas
 * @returns {Promise<void>}
 */
export async function persistPirkimoTurinys(pirkimoId, result) {
    const hash = crypto
        .createHash("md5")
        .update(JSON.stringify(result))
        .digest("hex");

    const { rows } = await postgres.query(
        `SELECT "turinysHash" FROM "eppsViesiejiPirkimai"."keys" WHERE "pirkimoId" = $1`,
        [pirkimoId],
    );
    if (rows[0]?.turinysHash === hash) return; // nepasikeitė — nieko neperrašom

    const client = await postgres.connect();
    try {
        await client.query("BEGIN");

        // 1. Keys (upsert)
        const keyValues = buildKeyValues(result);
        const cols = ['"pirkimoId"', '"turinysHash"', ...KEY_COLUMNS.map((c) => `"${c}"`)];
        const params = [pirkimoId, hash, ...keyValues];
        const placeholders = params.map((_, i) => `$${i + 1}`);
        const updates = cols
            .slice(1)
            .map((c) => `${c} = EXCLUDED.${c}`)
            .join(", ");
        await client.query(
            `INSERT INTO "eppsViesiejiPirkimai"."keys" (${cols.join(", ")})
             VALUES (${placeholders.join(", ")})
             ON CONFLICT ("pirkimoId") DO UPDATE SET ${updates}`,
            params,
        );

        // 2. Dalys (delete + insert)
        await client.query(
            `DELETE FROM "eppsViesiejiPirkimai"."dalys" WHERE "pirkimoId" = $1`,
            [pirkimoId],
        );
        for (const d of buildDalys(result)) {
            await client.query(
                `INSERT INTO "eppsViesiejiPirkimai"."dalys"
                    ("pirkimoId", "rusis", "numeris", "pavadinimas")
                 VALUES ($1, $2, $3, $4)`,
                [pirkimoId, d.rusis, d.numeris, d.pavadinimas],
            );
        }

        // 3. Failai (+ versijos per CASCADE) — delete + insert
        await client.query(
            `DELETE FROM "eppsViesiejiPirkimai"."failai" WHERE "pirkimoId" = $1`,
            [pirkimoId],
        );
        for (const f of Array.isArray(result.failai) ? result.failai : []) {
            const dokumentasId =
                f.dokumentasId != null && f.dokumentasId !== ""
                    ? Number(f.dokumentasId)
                    : null;
            const { rows: fr } = await client.query(
                `INSERT INTO "eppsViesiejiPirkimai"."failai"
                    ("pirkimoId", "dokumentasId", "papildymoId", "pavadinimas",
                     "dokumentasPavadinimas", "aprasymas", "kalba")
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING "id"`,
                [
                    pirkimoId,
                    dokumentasId,
                    parseText(f.papildymoId),
                    parseText(f.pavadinimas),
                    parseText(f.dokumentasPavadinimas),
                    parseText(f.aprasymas),
                    parseText(f.kalba),
                ],
            );
            const failasId = fr[0].id;
            for (const v of Array.isArray(f.versijos) ? f.versijos : []) {
                await client.query(
                    `INSERT INTO "eppsViesiejiPirkimai"."failuVersijos"
                        ("failasId", "versionId", "papildymoId", "pavadinimas",
                         "dokumentoVersija", "pakeitimai", "ikelimoData", "kalba",
                         "rengejas", "statusas")
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [
                        failasId,
                        v.versionId != null && v.versionId !== ""
                            ? Number(v.versionId)
                            : null,
                        parseText(v.papildymoId),
                        parseText(v.pavadinimas),
                        parseText(v.dokumentoVersija),
                        parseText(v.pakeitimai),
                        parseTs(v.ikelimoData),
                        parseText(v.kalba),
                        parseText(v.rengejas),
                        parseText(v.statusas),
                    ],
                );
            }
        }

        // 4. Skelbimai — delete + insert
        await client.query(
            `DELETE FROM "eppsViesiejiPirkimai"."skelbimai" WHERE "pirkimoId" = $1`,
            [pirkimoId],
        );
        for (const s of Array.isArray(result.skelbimai) ? result.skelbimai : []) {
            await client.query(
                `INSERT INTO "eppsViesiejiPirkimai"."skelbimai"
                    ("pirkimoId", "tipas", "downloadHref", "externalId", "isLinked",
                     "ikelimoData", "kalba", "statusas", "paskelbimoData")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    pirkimoId,
                    parseText(s.tipas),
                    parseText(s.downloadHref),
                    parseText(s.externalId),
                    typeof s.isLinked === "boolean" ? s.isLinked : null,
                    parseTs(s.ikelimoData),
                    parseText(s.kalba),
                    parseText(s.statusas),
                    parseTs(s.paskelbimoData),
                ],
            );
        }

        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}
