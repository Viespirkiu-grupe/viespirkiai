import { postgres } from "../../postgres/postgres.js";

// Sutarties eilutės grąžinamos senaisiais laukų vardais, kad `cpva` schemos
// normalizavimas nepersiduotų į UI (src/components/sutartis) ir MCP atsakymus.
const SUTARTIES_LAUKAI = `
    c."id",
    c."projektoNr",
    c."pirkimoNr" AS "pirkimoNrCvpis",
    c."pirkimoPavadinimas" AS "pirkimoObjektas",
    c."sutartiesNr" AS "pirkimoSutartiesNr",
    c."sutartiesData" AS "pirkimoSutartiesData",
    c."sumaProjektui" AS "pirkimoSutartiesSumaSusijusiSuProjektu"`;

function legacyPirkimoNumeris(value) {
    return typeof value === "string" && /^\d+$/.test(value);
}

function tiekejoKodai(sutartis) {
    const values = [
        sutartis?.tiekejoKodas,
        ...(Array.isArray(sutartis?.papildomiTiekejaiKodai)
            ? sutartis.papildomiTiekejaiKodai
            : []),
    ];
    return Array.from(
        new Set(
            values
                .map((value) => String(value ?? "").trim())
                .filter(Boolean),
        ),
    );
}

function stripMatchColumns(row) {
    const {
        date_match: _dateMatch,
        amount_match: _amountMatch,
        match_score: _matchScore,
        ...cpvaRow
    } = row;
    return cpvaRow;
}

async function attachProjektai(rows, db) {
    const projektuNr = Array.from(
        new Set(rows.map((row) => row.projektoNr).filter(Boolean)),
    );
    if (projektuNr.length === 0) return rows;

    const projektai = await db
        .query(
            `SELECT p."projektoNr",
                    p."pavadinimas" AS "projektoPavadinimas",
                    o."pavadinimas" AS "projektoVykdytojas",
                    o."kodas"       AS "projektoVykdytojoKodas",
                    p."sutartiesData",
                    p."veikluPabaigosData" AS "projektoVeikluPabaigosData",
                    p."islaiduSuma" AS "isViso"
             FROM cpva."projektai" p
             LEFT JOIN cpva."organizacijos" o ON o."id" = p."vykdytojoId"
             WHERE p."projektoNr" = ANY($1::text[])`,
            [projektuNr],
        )
        .then((result) => result.rows);
    const byNr = new Map(
        projektai.map((projektas) => [projektas.projektoNr, projektas]),
    );
    for (const row of rows) {
        const projektas = byNr.get(row.projektoNr);
        if (projektas) row.projektas = projektas;
    }
    return rows;
}

async function loadLegacyMatch(sutartis, db) {
    if (!legacyPirkimoNumeris(sutartis?.pirkimoNumeris)) return [];
    return db
        .query(
            `SELECT DISTINCT ON (c."projektoNr") ${SUTARTIES_LAUKAI}
             FROM cpva."pirkimuSutartys" c
             WHERE c."pirkimoNr" = $1
             ORDER BY c."projektoNr", c."id"`,
            [sutartis.pirkimoNumeris],
        )
        .then((result) => result.rows);
}

async function loadContractMatch(sutartis, db) {
    const sutartiesNumeris = String(sutartis?.sutartiesNumeris ?? "").trim();
    const kodai = tiekejoKodai(sutartis);
    const sudarymoData = sutartis?.sudarymoData ?? null;
    const verte = sutartis?.verte ?? sutartis?.suma ?? null;
    if (!sutartiesNumeris || kodai.length === 0 || (!sudarymoData && verte == null)) {
        return [];
    }

    // "sutartiesData" dabar yra `date`, todėl palyginimas eina tiesiai per
    // ("sutartiesNr", "tiekejoId") indeksą be regex/cast'o kiekvienai eilutei.
    return db
        .query(
            `WITH tiekejai AS (
                 SELECT "id" FROM cpva."organizacijos" WHERE "kodas" = ANY($2::text[])
             ), candidates AS (
                 SELECT ${SUTARTIES_LAUKAI},
                        CASE WHEN $3::date IS NOT NULL
                                   AND c."sutartiesData" = $3::date
                             THEN 1 ELSE 0 END AS date_match,
                        CASE WHEN $4::numeric IS NOT NULL
                                   AND c."sumaProjektui" = $4::numeric
                             THEN 1 ELSE 0 END AS amount_match
                 FROM cpva."pirkimuSutartys" c
                 WHERE c."sutartiesNr" = $1
                   AND c."tiekejoId" IN (SELECT "id" FROM tiekejai)
             ), ranked AS (
                 SELECT *, date_match + amount_match AS match_score
                 FROM candidates
                 WHERE date_match = 1 OR amount_match = 1
             )
             SELECT DISTINCT ON ("projektoNr") *
             FROM ranked
             ORDER BY "projektoNr", match_score DESC, "id"`,
            [sutartiesNumeris, kodai, sudarymoData, verte],
        )
        .then((result) => result.rows.map(stripMatchColumns));
}

/**
 * Prijungia CPVA projektus prie VPM sutarties.
 *
 * Senam CPVA formatui pirmiausia naudojamas tikslus CVP IS pirkimo numeris.
 * Dabartiniam PRK formatui naudojamas sutarties numeris + tiekėjo kodas ir
 * reikalaujama, kad papildomai sutaptų sutarties data arba suma.
 */
export async function loadCpvaProjektai(sutartis, db = postgres) {
    const legacyRows = await loadLegacyMatch(sutartis, db);
    const rows = legacyRows.length > 0
        ? legacyRows
        : await loadContractMatch(sutartis, db);
    return attachProjektai(rows, db);
}
