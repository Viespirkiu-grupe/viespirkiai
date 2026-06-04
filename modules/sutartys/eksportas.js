/**
 * Bendra sutarčių eksporto logika: PG paketų skaitymas, MD5 papildymas,
 * eilutės transformacija į „švarų“ įrašą.
 *
 * Naudojama:
 *   - scripts/exportSutartys.js (į JSONL)
 *   - scripts/pushSutartysToSpinta.js (į Spintos API)
 */
import { postgres } from "../../postgres/postgres.js";
import { CONTRACT_TYPES } from "./contractTypes.js";

export const DEFAULT_BATCH_SIZE = 500;

function toIsoDate(value) {
    if (!value) return null;
    return String(value).slice(0, 10);
}

function toStringOrNull(value) {
    if (value === null || value === undefined) return null;
    // Pašalinam valdymo simbolius (pvz. „\r"/„\n", patekusius iš netvarkingų
    // šaltinio duomenų), kad jie nesugadintų eksporto įrašo.
    const s = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return s.length ? s : null;
}

/**
 * Kodas (tiekėjo / BVPŽ) naudojamas ir kaip Spintos `_where` upsert raktas, todėl
 * jame negali likti kabučių ar valdymo simbolių — netvarkinguose CSV duomenyse
 * kodas kartais būna apgaubtas kabutėmis su įsiterpusiu „\r", kas sugriautų filtrą.
 */
function toCodeOrNull(value) {
    const s = toStringOrNull(value);
    if (!s) return null;
    const cleaned = s.replace(/["']/g, "").trim();
    return cleaned.length ? cleaned : null;
}

function parseDocIds(url) {
    if (!url) return { dokId: null, fileId: null };
    const dokMatch = String(url).match(/dok_id=(\d+)/);
    const fileMatch = String(url).match(/file_id=(\d+)/);
    return {
        dokId: dokMatch ? dokMatch[1] : null,
        fileId: fileMatch ? fileMatch[1] : null,
    };
}

function stripBvpzChecksum(kodas) {
    if (!kodas) return null;
    const m = String(kodas).match(/^([0-9]+)(?:-[0-9])?$/);
    return m ? m[1] : null;
}

function buildBvpz(row) {
    const out = [];
    const main = stripBvpzChecksum(row.bvpzKodas);
    if (main) out.push({ kodas: main, pavadinimas: toStringOrNull(row.bvpzPavadinimas) });
    const extraKodai = row.papildomiBvpzKodai || [];
    const extraPavadinimai = row.papildomiBvpzPavadinimai || [];
    for (let i = 0; i < extraKodai.length; i++) {
        const kodas = stripBvpzChecksum(extraKodai[i]);
        if (!kodas) continue;
        out.push({ kodas, pavadinimas: toStringOrNull(extraPavadinimai[i]) });
    }
    return out;
}

function buildTiekejai(row) {
    const pavadinimas = toStringOrNull(row.tiekejas);
    const patikslinimas = toStringOrNull(row.tiekPavPatikslinimasImp || row.tiekPavPatikslinimas);
    const tiekejas = {
        kodas: toCodeOrNull(row.tiekejoKodas),
        pavadinimas,
        patikslinimas: patikslinimas && patikslinimas !== pavadinimas ? patikslinimas : null,
        salis: toStringOrNull(row.tiekSalisImp || row.tiekSalis),
    };
    const out = [tiekejas];
    const extraKodai = row.papildomiTiekejaiKodai || [];
    const extraPavadinimai = row.papildomiTiekejai || [];
    const n = Math.max(extraKodai.length, extraPavadinimai.length);
    for (let i = 0; i < n; i++) {
        out.push({
            kodas: toCodeOrNull(extraKodai[i]),
            pavadinimas: toStringOrNull(extraPavadinimai[i]),
            patikslinimas: null,
            salis: null,
        });
    }
    return out;
}

function buildDokumentai(row, md5Lookup) {
    const docs = Array.isArray(row.dokumentai) ? row.dokumentai : [];
    const out = [];
    for (const doc of docs) {
        const { dokId, fileId } = parseDocIds(doc?.url);
        if (!dokId || !fileId) continue;
        const md5 = md5Lookup.get(`${dokId}|${fileId}`);
        const entry = {
            dokId,
            fileId,
            pavadinimas: toStringOrNull(doc?.pavadinimas),
        };
        if (md5) entry.md5 = md5;
        out.push(entry);
    }
    return out;
}

/**
 * „Įdėtinis“ eksporto įrašas — toks pat, koks patenka į JSONL eilutę.
 */
export function buildExportRecord(row, md5Lookup) {
    const tipas = toStringOrNull(row.tipas);
    const tipoKey = tipas ? tipas.toUpperCase() : null;
    return {
        id: Number(row.sutartiesUnikalusId),
        sutartiesNumeris: toStringOrNull(row.sutartiesNumeris),
        pavadinimas: toStringOrNull(row.pavadinimas),
        tipas,
        tipoPavadinimas: tipoKey ? (CONTRACT_TYPES[tipoKey] || tipas) : null,
        pirkimoNumeris: toStringOrNull(row.pirkimoNumeris),

        datos: {
            sudaryta:  toIsoDate(row.sudarymoData),
            galioja:   toIsoDate(row.galiojimoData),
            ivykdyta:  toIsoDate(row.faktineIvykdimoData),
            paskelbta: toIsoDate(row.paskelbimoData),
            redaguota: toIsoDate(row.paskutinioRedagavimoData),
        },

        vertes: {
            numatyta: row.verte ?? null,
            faktine:  row.faktineIvykdimoVerte ?? null,
            suma:     row.suma ?? null,
        },

        klasifikacija: {
            kategorija: toStringOrNull(row.kategorija),
            bvpz: buildBvpz(row),
        },

        pirkejas: {
            kodas: toStringOrNull(row.perkanciosiosOrganizacijosKodas),
            pavadinimas: toStringOrNull(row.perkanciojiOrganizacija),
        },

        tiekejai: buildTiekejai(row),
        dokumentai: buildDokumentai(row, md5Lookup),
    };
}

/**
 * „Reliacinis“ vaizdas Spintai: tas pats turinys, bet vaikinės struktūros
 * atskirtos į savo masyvus, kad būtų galima POST'inti į atskirus modelius.
 *
 * Tiekėjai/BVPŽ/dokumentai dar negauna `sutartis` ref'o — jis pridedamas
 * push'inant, kai žinom parent `_id`.
 */
export function buildSpintaRecords(row, md5Lookup) {
    const full = buildExportRecord(row, md5Lookup);
    const { klasifikacija, tiekejai, dokumentai, ...parentRest } = full;
    const parent = {
        ...parentRest,
        klasifikacija: { kategorija: klasifikacija.kategorija },
    };
    return {
        parent,
        bvpz: klasifikacija.bvpz,
        tiekejai,
        dokumentai,
    };
}

export async function fetchMd5Lookup(rows) {
    const dokIds = [];
    const fileIds = [];
    const seen = new Set();
    for (const row of rows) {
        const docs = Array.isArray(row.dokumentai) ? row.dokumentai : [];
        for (const doc of docs) {
            const { dokId, fileId } = parseDocIds(doc?.url);
            if (!dokId || !fileId) continue;
            const key = `${dokId}|${fileId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            dokIds.push(Number(dokId));
            fileIds.push(Number(fileId));
        }
    }
    const lookup = new Map();
    if (!dokIds.length) return lookup;
    const { rows: md5Rows } = await postgres.query(
        `SELECT f."dokId", f."fileId", f.md5
         FROM failai f
         JOIN unnest($1::int[], $2::int[]) AS x("dokId", "fileId")
           ON f."dokId" = x."dokId" AND f."fileId" = x."fileId"
         WHERE f.md5 IS NOT NULL`,
        [dokIds, fileIds],
    );
    for (const r of md5Rows) {
        lookup.set(`${r.dokId}|${r.fileId}`, r.md5);
    }
    return lookup;
}

export async function fetchBatch(afterId, batchSize = DEFAULT_BATCH_SIZE) {
    const { rows } = await postgres.query(
        `
        SELECT
            s.*,
            a."tiekPavPatikslinimas",
            a."tiekSalis",
            ai."tiekSbjPatikslinimas" AS "tiekPavPatikslinimasImp",
            ai."tiekSalis"            AS "tiekSalisImp"
        FROM sutartys s
        LEFT JOIN "sutartysAtviriDuomenys"    a  ON a."dokId"  = s."sutartiesUnikalusId"
        LEFT JOIN "sutartysAtviriDuomenysImp" ai ON ai."dokId" = s."sutartiesUnikalusId"
        WHERE s."sutartiesUnikalusId" > $1
          AND COALESCE(s.istrinta, false) = false
        ORDER BY s."sutartiesUnikalusId" ASC
        LIMIT $2
        `,
        [afterId, batchSize],
    );
    return rows;
}

/**
 * Async generator: iteruoja per visas sutartis batch'ais ir grąžina
 * `{ rows, md5Lookup, afterId }` po kiekvieno PG užklausų komplekto.
 */
export async function* iterateBatches({ batchSize = DEFAULT_BATCH_SIZE, startAfterId = 0 } = {}) {
    let afterId = startAfterId;
    while (true) {
        const rows = await fetchBatch(afterId, batchSize);
        if (!rows.length) return;
        const md5Lookup = await fetchMd5Lookup(rows);
        afterId = Number(rows[rows.length - 1].sutartiesUnikalusId);
        yield { rows, md5Lookup, afterId };
    }
}
