// benchmarks/variedBenchmark.js
//
// Įvairialypis („varied“) PostgreSQL benchmark pagal dbSchema/ padumpintą schemą.
//
// Tikslas — daug skirtingo pobūdžio realių duomenų skaičiavimų, kurių darbinis
// rinkinys netelpa į shared_buffers / OS puslapių cache. Todėl:
//   * skenuojamos didžiausios lentelės pilnai (seq scan),
//   * agregacijos su didelio kardinalumo GROUP BY (dideli hash tables),
//   * rūšiavimai / langų funkcijos verčia išsilieti į diską (work_mem overflow),
//   * hash join'ai bei self-join'ai tarp milijoninių lentelių.
//
// Kiekviena užklausa sukalibruota maždaug ~10 s (didelės lentelės ribojamos
// nuosekliu puslapių ruožu per ctid, o daug-su-daug join'ai iš anksto
// suagreguojami, kad nesprogtų). Grynų CPU ciklų (generate_series) čia NĖRA.
//
// Prisijungimas imamas iš postgres/postgres.js (pagrindinė DB pagal config.js).
//
// Paleidimas:
//   node benchmarks/variedBenchmark.js
//   SAMPLE=30 node benchmarks/variedBenchmark.js      # didesnė imtis = sunkiau
//   TIMEOUT=60 node benchmarks/variedBenchmark.js     # ilgesnis limitas (s)
//   node benchmarks/variedBenchmark.js --explain      # EXPLAIN (ANALYZE, BUFFERS)
//   node benchmarks/variedBenchmark.js --only=Q4,Q7   # tik pasirinktos užklausos

import { postgres } from "../postgres/postgres.js";

// Kiek maždaug MB heap'o skenuoti per užklausą. Didelės lentelės (sutartys ~9 GB,
// dokumentai ~2.6 GB…) ribojamos nuosekliu puslapių ruožu (ctid < '(N,0)'), kad
// kiekvienas žingsnis nuskaitytų ~TARGET_MB ir truktų apie ~10 s. Šitos DB diskas
// greitas tik nuosekliai skaitant, tad ~300 MB ≈ 10 s. Didink → sunkiau/ilgiau.
const TARGET_MB = Number(process.env.TARGET_MB || 300);
// 8 KB puslapiai: 1 MB = 128 puslapių. :PAGES — pilnas biudžetas (vienos lentelės
// užklausoms), :PAGES2 — pusė (užklausoms, skenuojančioms dvi dideles lenteles).
const PAGES = Math.round(TARGET_MB * 128);
const PAGES2 = Math.round((TARGET_MB * 128) / 2);
// Kiek sekundžių leidžiam vienai užklausai (apsauga nuo „niekad nesibaigia“).
const TIMEOUT_S = Number(process.env.TIMEOUT || 40);
const EXPLAIN = process.argv.includes("--explain");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "")
    .replace("--only=", "")
    .split(",")
    .filter(Boolean);

// Sąmoningai mažas work_mem, kad rūšiavimai/hash'ai lietųsi į diską.
const SESSION_SETUP = [
    "SET jit = on",
    "SET work_mem = '16MB'",
    "SET max_parallel_workers_per_gather = 4",
    "SET enable_seqscan = on",
    `SET statement_timeout = '${TIMEOUT_S}s'`,
];

// Pastaba dėl imties: šios DB diskas greitas tik nuosekliai skaitant, o
// TABLESAMPLE SYSTEM / LIMIT subužklausa arba daro atsitiktinį I/O, arba blokuoja
// paralelizmą. Todėl didelės lentelės ribojamos nuosekliu PUSLAPIŲ ruožu —
// `WHERE ctid < '(N,0)'::tid` (tidrange skenas) — ir projektuojami tik reikalingi
// stulpeliai (kad nebūtų skaitomas tsvector/jsonb TOAST). :PAGES ir :PAGES2
// (pusė) main() metu virsta puslapių skaičiumi, atitinkančiu ~TARGET_MB heap'o.

/** @type {{id: string, desc: string, sql: string}[]} */
const QUERIES = [
    {
        id: "Q2",
        desc: "sutartys: nuoseklus prefiksas — agregacija metai × BVPZ (didelis hash)",
        sql: `
            SELECT
                date_part('year', "sudarymoData")            AS metai,
                left(coalesce("bvpzKodas", '—'), 8)          AS bvpz,
                count(*)                                     AS kiekis,
                sum(verte)::numeric(20,2)                    AS verte_viso,
                avg(verte)::numeric(20,2)                    AS verte_vid,
                stddev_pop(verte)::numeric(20,2)             AS verte_std,
                count(*) FILTER (WHERE verte > 100000)       AS stambiu
            FROM (
                SELECT "sudarymoData", "bvpzKodas", verte, istrinta
                FROM sutartys WHERE ctid < '(:PAGES,0)'::tid
            ) sutartys
            WHERE NOT coalesce(istrinta, false)
            GROUP BY 1, 2
            HAVING count(*) > 3
            ORDER BY verte_viso DESC NULLS LAST
            LIMIT 200`,
    },
    {
        id: "Q3",
        desc: "sutartys: langų funkcijos — running sum + metų rangas (spill)",
        sql: `
            SELECT count(*) AS eilutes, max(bego)::numeric(20,2) AS max_beganti_suma,
                   max(metu_rangas) AS max_rangas
            FROM (
                SELECT
                    sum(verte) OVER (
                        PARTITION BY "tiekejoKodas"
                        ORDER BY "sudarymoData"
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS bego,
                    rank() OVER (
                        PARTITION BY date_part('year', "sudarymoData")
                        ORDER BY verte DESC NULLS LAST
                    ) AS metu_rangas
                FROM (
                    SELECT "tiekejoKodas", "sudarymoData", verte
                    FROM sutartys WHERE ctid < '(:PAGES,0)'::tid
                ) src
                WHERE verte IS NOT NULL AND "tiekejoKodas" IS NOT NULL
            ) w`,
    },
    {
        id: "Q4",
        desc: "hash join: sutartys × iš anksto suagreguota sodra (pagal jarKodas)",
        sql: `
            WITH sodra_agg AS (
                SELECT "jarKodas",
                       avg("vidutinisAtlyginimas")::numeric(12,2) AS atlyg,
                       max(draustieji)                            AS draustieji
                FROM (
                    SELECT "jarKodas"::text AS "jarKodas", "vidutinisAtlyginimas", draustieji
                    FROM "sodraMonthly" WHERE ctid < '(:PAGES2,0)'::tid
                ) s
                WHERE "jarKodas" IS NOT NULL
                GROUP BY "jarKodas"
            )
            SELECT
                su."tiekejoKodas"                            AS tiekejo_kodas,
                count(*)                                     AS sutarciu,
                sum(su.verte)::numeric(20,2)                 AS verte_viso,
                avg(s.atlyg)::numeric(12,2)                  AS atlyg_vid,
                max(s.draustieji)                            AS draustieji
            FROM (
                SELECT "tiekejoKodas", verte
                FROM sutartys WHERE ctid < '(:PAGES2,0)'::tid
            ) su
            JOIN sodra_agg s ON s."jarKodas" = su."tiekejoKodas"
            WHERE su.verte IS NOT NULL
            GROUP BY 1
            ORDER BY verte_viso DESC NULLS LAST
            LIMIT 100`,
    },
    {
        id: "Q5",
        desc: "sodra self-join: metai-prieš-metus draustųjų pokytis",
        sql: `
            WITH s AS (
                SELECT "jarKodas", data, draustieji
                FROM (
                    SELECT "jarKodas", data, draustieji
                    FROM "sodraMonthly" WHERE ctid < '(:PAGES2,0)'::tid
                ) x
                WHERE draustieji IS NOT NULL AND "jarKodas" IS NOT NULL
            )
            SELECT
                count(*)                                        AS poru,
                avg(a.draustieji - b.draustieji)::numeric(12,2) AS vid_pokytis,
                max(a.draustieji - b.draustieji)                AS max_augimas,
                min(a.draustieji - b.draustieji)                AS max_kritimas
            FROM s a
            JOIN s b ON a."jarKodas" = b."jarKodas" AND a.data = b.data + interval '1 month'`,
    },
    {
        id: "Q6",
        desc: "mokesciai: mėnesinė dinamika su lag (pilnas skenas)",
        sql: `
            SELECT count(*) AS eilutes, sum(abs(pokytis))::numeric(20,2) AS abs_pokyciu_suma
            FROM (
                SELECT
                    sum(suma) - lag(sum(suma)) OVER (
                        PARTITION BY savivaldybe ORDER BY metai, menuo
                    ) AS pokytis
                FROM mokesciai
                GROUP BY savivaldybe, metai, menuo
            ) m
            WHERE pokytis IS NOT NULL`,
    },
    {
        id: "Q7",
        desc: "regitra: tekstas→skaičius castai + CO2/galios agregacija (CPU)",
        sql: `
            SELECT
                marke,
                count(*) AS kiekis,
                avg(nullif(regexp_replace(galia, '[^0-9.]', '', 'g'), '')::numeric)        AS galia_vid,
                avg(nullif(regexp_replace("CO2Kiekis", '[^0-9.]', '', 'g'), '')::numeric)  AS co2_vid,
                avg(nullif(regexp_replace("nuosavaMase", '[^0-9.]', '', 'g'), '')::numeric) AS mase_vid
            FROM regitra
            GROUP BY marke
            HAVING count(*) > 5
            ORDER BY kiekis DESC
            LIMIT 100`,
    },
    {
        id: "Q8",
        desc: "balansas × pelno/nuostolio: iš anksto suagreguoti ir sujungti",
        sql: `
            WITH b AS (
                SELECT "jarId", "laikotarpisIki", sum(reiksme) AS turtas
                FROM (
                    SELECT "jarId", "laikotarpisIki", reiksme
                    FROM "balansoAtaskaitos" WHERE ctid < '(:PAGES2,0)'::tid
                ) bb
                WHERE reiksme IS NOT NULL
                GROUP BY 1, 2
            ), p AS (
                SELECT "jarId", "laikotarpisIki", sum(reiksme) AS pelnas
                FROM (
                    SELECT "jarId", "laikotarpisIki", reiksme
                    FROM "pelnoNuostoliuAtaskaitos" WHERE ctid < '(:PAGES2,0)'::tid
                ) pp
                WHERE reiksme IS NOT NULL
                GROUP BY 1, 2
            )
            SELECT
                date_part('year', b."laikotarpisIki")     AS metai,
                count(*)                                  AS imoniu_ataskaitu,
                sum(b.turtas)::numeric(20,2)              AS turto_suma,
                sum(p.pelnas)::numeric(20,2)              AS pelno_suma,
                corr(b.turtas, p.pelnas)::numeric(10,6)   AS koreliacija
            FROM b JOIN p USING ("jarId", "laikotarpisIki")
            GROUP BY 1
            ORDER BY 1 DESC NULLS LAST
            LIMIT 100`,
    },
    {
        id: "Q9",
        desc: "pinreg: masyvų unnest — juridinių ryšių sprogimas (pilnas skenas)",
        sql: `
            SELECT count(*) AS rysiu_eilutes, count(DISTINCT jar) AS unikalus_jar
            FROM (
                SELECT unnest("juridiniaiRysiaiJar" || "darbovietesJar") AS jar
                FROM pinreg
                WHERE "juridiniaiRysiaiJar" IS NOT NULL OR "darbovietesJar" IS NOT NULL
            ) u
            WHERE jar IS NOT NULL`,
    },
    {
        id: "Q10",
        desc: "dokumentai: apimčių agregacija pagal domeną/savivaldybę",
        sql: `
            SELECT
                coalesce(domain, '—')           AS domenas,
                coalesce(savivaldybe, '—')      AS savivaldybe,
                count(*)                        AS dok_kiekis,
                sum("wordCount")                AS zodziu_viso,
                sum("characterCount")           AS simboliu_viso,
                avg("pageCount")::numeric(10,2) AS psl_vid
            FROM (
                SELECT domain, savivaldybe, "wordCount", "characterCount", "pageCount"
                FROM dokumentai WHERE ctid < '(:PAGES,0)'::tid
            ) dokumentai
            GROUP BY 1, 2
            ORDER BY zodziu_viso DESC NULLS LAST
            LIMIT 200`,
    },
    {
        id: "Q11",
        desc: "failai: OCR statistika pagal node/tipą",
        sql: `
            SELECT
                coalesce("ocrNode", '—')            AS node,
                coalesce(tipas, '—')                AS tipas,
                count(*)                            AS failu,
                sum("zodziuSkaicius")               AS zodziu,
                avg("ocrDuration")::numeric(12,3)   AS ocr_vid_s,
                stddev_samp("ocrDuration")::numeric(12,3) AS ocr_std,
                max("puslapiuSkaicius")             AS max_psl
            FROM (
                SELECT "ocrNode", tipas, "zodziuSkaicius", "ocrDuration", "puslapiuSkaicius"
                FROM failai WHERE ctid < '(:PAGES,0)'::tid
            ) failai
            GROUP BY 1, 2
            ORDER BY failu DESC
            LIMIT 150`,
    },
    {
        id: "Q12",
        desc: "jar: pavadinimų teksto analizė (pilnas skenas, žodžių count)",
        sql: `
            SELECT
                upper(left(coalesce(pavadinimas, '?'), 1)) AS raide,
                count(*)                                   AS kiekis,
                avg(array_length(regexp_split_to_array(trim(pavadinimas), '\\s+'), 1))::numeric(6,2) AS zodziu_vid,
                avg(length(pavadinimas))::numeric(6,2)     AS ilgio_vid,
                count(*) FILTER (WHERE "isregistravimoData" IS NOT NULL) AS isregistruota
            FROM jar
            GROUP BY 1
            ORDER BY kiekis DESC
            LIMIT 100`,
    },
    {
        id: "Q13",
        desc: "sutartys: rūšiavimas pagal md5 hash (spill į diską)",
        sql: `
            SELECT md5(string_agg("sutartiesUnikalusId"::text, ',')) AS kontrolinis
            FROM (
                SELECT "sutartiesUnikalusId"
                FROM (
                    SELECT "sutartiesUnikalusId", pavadinimas, verte
                    FROM sutartys WHERE ctid < '(:PAGES,0)'::tid
                ) src
                WHERE verte IS NOT NULL
                ORDER BY md5("sutartiesUnikalusId"::text || coalesce(pavadinimas, ''))
            ) s`,
    },
    {
        id: "Q15",
        desc: "sutartys: full-text paieška + ts_rank (GIN indeksas + rank)",
        sql: `
            SELECT count(*) AS rasta, avg(rnk)::numeric(10,6) AS rango_vid
            FROM (
                SELECT ts_rank(search_tsv, plainto_tsquery('simple', 'paslaugos')) AS rnk
                FROM sutartys
                WHERE search_tsv @@ plainto_tsquery('simple', 'paslaugos')
                LIMIT 100000
            ) r`,
    },
];

function fmtMs(ms) {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
    return `${ms.toFixed(1)} ms`;
}

// :PAGES / :PAGES2 → puslapių skaičius ctid ruožui (pilnas / pusė biudžeto).
function applyPages(sql) {
    return sql.replace(/:PAGES2/g, String(PAGES2)).replace(/:PAGES/g, String(PAGES));
}

async function main() {
    const selected = ONLY.length
        ? QUERIES.filter((q) => ONLY.includes(q.id))
        : QUERIES;

    console.log("════════════════════════════════════════════════════════════");
    console.log(` VARIED BENCHMARK   target≈${TARGET_MB}MB/užklausą (${PAGES} psl.)   timeout=${TIMEOUT_S}s   ${EXPLAIN ? "(EXPLAIN ANALYZE, BUFFERS)" : ""}`);
    console.log(`   užklausų: ${selected.length}`);
    console.log("════════════════════════════════════════════════════════════");

    // Vienas dedikuotas klientas — kad SET nustatymai galiotų visai sesijai.
    const client = await postgres.connect();
    const results = [];
    try {
        for (const s of SESSION_SETUP) await client.query(s);

        for (const q of selected) {
            const base = applyPages(q.sql);
            const sql = EXPLAIN
                ? `EXPLAIN (ANALYZE, BUFFERS, TIMING, FORMAT TEXT) ${base}`
                : base;
            process.stdout.write(`\n── ${q.id}: ${q.desc}\n`);
            const t0 = process.hrtime.bigint();
            let ok = true;
            try {
                const res = await client.query(sql);
                const t1 = process.hrtime.bigint();
                const ms = Number(t1 - t0) / 1e6;
                results.push({ id: q.id, ms });
                if (EXPLAIN) {
                    for (const row of res.rows) console.log("   " + row["QUERY PLAN"]);
                } else {
                    console.log("   → " + JSON.stringify(res.rows[0] ?? {}));
                }
                console.log(`   ⏱  ${fmtMs(ms)}`);
            } catch (err) {
                ok = false;
                const t1 = process.hrtime.bigint();
                const ms = Number(t1 - t0) / 1e6;
                results.push({ id: q.id, ms, error: err.message });
                console.log(`   ✗ KLAIDA: ${err.message}`);
            }
            if (!ok && process.env.STOP_ON_ERROR) break;
        }
    } finally {
        client.release();
        await postgres.end();
    }

    console.log("\n════════════════════════════════════════════════════════════");
    console.log(" SANTRAUKA (nuo lėčiausios)");
    console.log("════════════════════════════════════════════════════════════");
    const sorted = [...results].sort((a, b) => b.ms - a.ms);
    let total = 0;
    for (const r of sorted) {
        total += r.ms;
        const tag = r.error ? "  ✗" : "";
        console.log(`  ${r.id.padEnd(4)} ${fmtMs(r.ms).padStart(10)}${tag}`);
    }
    console.log("  ─────────────────────");
    console.log(`  VISO ${fmtMs(total).padStart(9)}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
