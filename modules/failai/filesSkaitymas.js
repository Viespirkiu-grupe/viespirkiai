import { postgres } from "../../postgres/postgres.js";
import { sujungtiSaltinioId } from "./failuIrasymas.js";

/*
Failo eilutės skaitymas iš naujos schemos senuoju pavidalu.

Konvejeris (parsiuntimas, nuskaitymas, OCR) ir puslapiai iki šiol gaudavo `failai`
eilutę su `pavadinimas`, `extension`, `md5`, `saltinis`, `saltinioId` ir t. t.
Naujoje schemoje tos reikšmės išsklaidytos po žodynus, o šaltinio ID — po keturis
stulpelius. Kad nereikėtų vienu metu perrašyti ir schemos, ir visų vartotojų,
čia surenkama ta pati forma:

  - žodynai išskleidžiami į tekstą (`pavadinimas`, `extension`, `md5`, `autorius`, `saltinis`);
  - specialūs failo tipai surenkami į `specialTypes` masyvą;
  - `saltinioId` atkuriamas iš `sourceId0..3` (sujungtiSaltinioId — atvirkštinė
    skaidymo operacija), tad linkų konstruktoriams nieko keisti nereikia;
  - senų stulpelių atitikmenys pervadinami atgal (`downloadStatus` → `parsiustas`,
    `filesDataExtraction.version/status` → `nuskaitytas`, `filesOcrStatus.status` → `ocrState`).

Naujus vartotojus geriau rašyti tiesiai ant `sourceId0..3` — jie grąžinami taip pat.
*/

/** Stulpelių sąrašas — vienoje vietoje, kad visi skaitytojai gautų tą pačią formą. */
export const FILES_SELECT = `
    f.id,
    f.parent,
    f.child,
    fn.filename           AS pavadinimas,
    e.extension,
    m.md5,
    a.author              AS autorius,
    f.filesize            AS dydis,
    f."downloadStatus"    AS parsiustas,
    st.title              AS saltinis,
    f."sourceId0", f."sourceId1", f."sourceId2", f."sourceId3",
    d.version, d.status   AS "extractionStatus",
    d."wordCount"         AS "zodziuSkaicius",
    d."pageCount"         AS "puslapiuSkaicius",
    d."characterCount"    AS "simboliuSkaicius",
    d."extractedAt"       AS "nuskaitymasTimestamp",
    o.status              AS "ocrState",
    o."resultHash"        AS "ocrResultHash",
    o."resultsCount"      AS "ocrResultsCount",
    o.duration            AS "ocrDuration",
    o."ocrTimestamp",
    o."lockTimestamp"     AS "ocrLockTimestamp",
    o.attempts            AS "ocrBandymai",
    ocrn.pavadinimas      AS "ocrNode",
    p.password,
    loc.location,
    i."fileHash"          AS "failasHash",
    COALESCE(
        ARRAY(
            SELECT tn.type
            FROM public."filesSpecialTypes" fst
            JOIN public."filesSpecialTypeNames" tn ON tn.id = fst."typeId"
            WHERE fst.id = f.id
            ORDER BY tn.type
        ),
        ARRAY[]::text[]
    )                     AS "specialTypes"
`;

/** JOIN'ai, kurių reikia FILES_SELECT stulpeliams. */
export const FILES_JOINS = `
    LEFT JOIN public."filesFilenames"    fn  ON fn.id  = f."filenameId"
    LEFT JOIN public."filesExtensions"   e   ON e.id   = f."extensionId"
    LEFT JOIN public."filesMd5"          m   ON m.id   = f."md5Id"
    LEFT JOIN public."filesAuthors"      a   ON a.id   = f."authorId"
    LEFT JOIN public."filesSourceTitles" st  ON st.id  = f."sourceTitleId"
    LEFT JOIN public."filesDataExtraction" d ON d.id   = f.id
    LEFT JOIN public."filesOcrStatus"    o   ON o.id   = f.id
    LEFT JOIN infra."ocrNuskaitytojai"  ocrn ON ocrn.id = o."nodeId"
    LEFT JOIN public."filesPasswords"    p   ON p.id   = f.id
    LEFT JOIN public."filesLocations"    loc ON loc.id = f.id
    LEFT JOIN public."filesInfoFiles"    i   ON i.id   = f.id
`;

/**
 * Papildo eilutę išvestiniais laukais, kurių senoji schema turėjo stulpeliuose.
 * @param {Record<string, any>|null} eilute
 * @returns {Record<string, any>|null}
 */
export function papildytiFaila(eilute) {
    if (!eilute) return null;

    // saltinioId atkuriamas iš pozicijų — tokia pati reikšmė, kokia buvo failai.saltinioId.
    eilute.saltinioId = sujungtiSaltinioId(eilute.saltinis, [
        eilute.sourceId0,
        eilute.sourceId1,
        eilute.sourceId2,
        eilute.sourceId3,
    ]);

    // Sutartims šaltinio pozicijos yra dokId/fileId.
    if (eilute.saltinis === "sutartys") {
        eilute.dokId = eilute.sourceId0 == null ? null : Number(eilute.sourceId0);
        eilute.fileId = eilute.sourceId1 == null ? null : Number(eilute.sourceId1);
        eilute.saltinioId = null;
    } else {
        eilute.dokId = null;
        eilute.fileId = null;
    }

    // `nuskaitytas` senoje schemoje buvo viena reikšmė: versija arba klaidos kodas.
    eilute.nuskaitytas =
        eilute.version == null
            ? null
            : eilute.extractionStatus < 0
                ? eilute.extractionStatus
                : eilute.version;

    return eilute;
}

/**
 * Grąžina vieną failą senuoju pavidalu.
 * @param {number} id
 * @param {import("pg").ClientBase} [klientas]
 * @returns {Promise<Record<string, any>|null>}
 */
export async function gautiFaila(id, klientas = postgres) {
    const { rows } = await klientas.query(
        `SELECT ${FILES_SELECT} FROM public.files f ${FILES_JOINS} WHERE f.id = $1`,
        [id],
    );
    return papildytiFaila(rows[0] ?? null);
}

/**
 * Grąžina kelis failus senuoju pavidalu.
 * @param {number[]} ids
 * @param {import("pg").ClientBase} [klientas]
 */
export async function gautiFailus(ids, klientas = postgres) {
    if (!ids?.length) return [];
    const { rows } = await klientas.query(
        `SELECT ${FILES_SELECT} FROM public.files f ${FILES_JOINS} WHERE f.id = ANY($1::int[])`,
        [ids],
    );
    return rows.map(papildytiFaila);
}
