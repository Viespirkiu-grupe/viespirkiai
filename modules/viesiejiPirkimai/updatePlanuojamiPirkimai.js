import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { isVptWorkingHours } from "../sutartys/isWorkingHours.js";
import { processPlanuojamiPirkimai } from "./scrapePlanuojamiPirkimai.js";

const TIME_ZONE = "Europe/Vilnius";
const DEFAULT_DAYS = 7;
const defaultLogger = { log };
const SCHEMA_TABLES = [
    'public."planuojamiPirkimai"',
    'public."planuojamiPirkimaiDuomenys"',
    'public."planuojamiPirkimaiBvpzKodai"',
    'public."planuojamiPirkimaiAtnaujinimai"',
    'public."planuojamiPirkimaiSearch"',
    'public."planuojamiPirkimaiVykdytojai"',
    'public."planuojamiPirkimaiVykdytojaiAtnaujinimai"',
    'public."planuojamiPirkimaiTipai"',
    'public."planuojamiPirkimaiDirektyvos"',
    'public."planuojamiPirkimaiBudai"',
];

function pad(value) {
    return String(value).padStart(2, "0");
}

function lithuanianCalendarDate(now) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        })
            .formatToParts(now)
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value]),
    );
    return { year: +parts.year, month: +parts.month, day: +parts.day };
}

export function recentPublicationRange(now = new Date(), days = DEFAULT_DAYS) {
    if (!Number.isInteger(days) || days < 1) {
        throw new Error("Dienų skaičius turi būti teigiamas sveikasis skaičius");
    }
    const today = lithuanianCalendarDate(now);
    const end = Date.UTC(today.year, today.month - 1, today.day);
    const start = end - (days - 1) * 24 * 60 * 60 * 1000;
    const formatDate = (timestamp) => {
        const date = new Date(timestamp);
        return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    };
    return {
        from: `${formatDate(start)}T00:00`,
        to: `${formatDate(end)}T23:59`,
    };
}

export async function assertPlanuojamiPirkimaiSchema(db = postgres) {
    const { rows } = await db.query(
        `SELECT name, to_regclass(name) AS relation FROM unnest($1::text[]) name`,
        [SCHEMA_TABLES],
    );
    const existing = new Set(
        rows.filter((row) => row.relation != null).map((row) => row.name),
    );
    if (existing.size === SCHEMA_TABLES.length) return;
    const missing = SCHEMA_TABLES.filter((name) => !existing.has(name)).join(", ");
    throw new Error(
        `Trūksta planuojamų pirkimų DB schemos lentelių: ${missing}. ` +
            `Aplikacijos kodas DB struktūros nekeičia.`,
    );
}

export async function upsertPlanuojamiPirkimai(records, db = postgres) {
    if (!records.length) return 0;
    // EPPS CSV neturi stabilaus ID ir kartais grąžina kelias visiškai vienodas
    // eilutes. Viename INSERT tas pats conflict raktas negali būti paliestas
    // dukart, todėl batch deduplikuojame pagal vartotojo pasirinktą md5 raktą.
    const uniqueRecords = [...new Map(records.map((row) => [row.md5, row])).values()];
    const { rows } = await db.query(
        `
        WITH incoming AS MATERIALIZED (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
            md5 text,
            "pirkimoVykdytojas" text,
            "pirkimoPavadinimas" text,
            aprasymas text,
            "pirkimoTipas" text,
            direktyva text,
            "pirkimoBudas" text,
            "bvpzKodai" text[],
            "bvpzKodaiRaw" text,
            "apskaiciuotaKaina" numeric,
            kiekiai text,
            "pirkimoPradziosData" timestamp without time zone,
            "pasiulymuTeikimoData" timestamp without time zone,
            "numatomaSutartiesTrukmeMenesiais" numeric,
            "sutartiesTrukmesMatavimoVienetas" text,
            "preliminariPirkimoSukurimoData" timestamp without time zone
          )
        ),
        inserted_organizations AS (
          INSERT INTO public."planuojamiPirkimaiVykdytojai" (pavadinimas)
          SELECT DISTINCT "pirkimoVykdytojas"
          FROM incoming
          WHERE NULLIF("pirkimoVykdytojas", '') IS NOT NULL
          ON CONFLICT (pavadinimas) DO NOTHING
          RETURNING id, pavadinimas, "jarKodas"
        ),
        all_organizations AS MATERIALIZED (
          SELECT id, pavadinimas, "jarKodas"
          FROM public."planuojamiPirkimaiVykdytojai"
          WHERE pavadinimas IN (
            SELECT "pirkimoVykdytojas" FROM incoming
          )
          UNION ALL
          SELECT id, pavadinimas, "jarKodas" FROM inserted_organizations
        ),
        organization_tracking AS (
          INSERT INTO public."planuojamiPirkimaiVykdytojaiAtnaujinimai" ("vykdytojoId")
          SELECT DISTINCT id FROM all_organizations
          ON CONFLICT ("vykdytojoId") DO NOTHING
          RETURNING "vykdytojoId"
        ),
        inserted_types AS (
          INSERT INTO public."planuojamiPirkimaiTipai" (pavadinimas)
          SELECT DISTINCT "pirkimoTipas" FROM incoming
          WHERE NULLIF("pirkimoTipas", '') IS NOT NULL
          ON CONFLICT (pavadinimas) DO NOTHING
          RETURNING id, pavadinimas
        ),
        all_types AS MATERIALIZED (
          SELECT id, pavadinimas FROM public."planuojamiPirkimaiTipai"
          WHERE pavadinimas IN (SELECT "pirkimoTipas" FROM incoming)
          UNION ALL SELECT id, pavadinimas FROM inserted_types
        ),
        inserted_directives AS (
          INSERT INTO public."planuojamiPirkimaiDirektyvos" (pavadinimas)
          SELECT DISTINCT direktyva FROM incoming
          WHERE NULLIF(direktyva, '') IS NOT NULL
          ON CONFLICT (pavadinimas) DO NOTHING
          RETURNING id, pavadinimas
        ),
        all_directives AS MATERIALIZED (
          SELECT id, pavadinimas FROM public."planuojamiPirkimaiDirektyvos"
          WHERE pavadinimas IN (SELECT direktyva FROM incoming)
          UNION ALL SELECT id, pavadinimas FROM inserted_directives
        ),
        inserted_methods AS (
          INSERT INTO public."planuojamiPirkimaiBudai" (pavadinimas)
          SELECT DISTINCT "pirkimoBudas" FROM incoming
          WHERE NULLIF("pirkimoBudas", '') IS NOT NULL
          ON CONFLICT (pavadinimas) DO NOTHING
          RETURNING id, pavadinimas
        ),
        all_methods AS MATERIALIZED (
          SELECT id, pavadinimas FROM public."planuojamiPirkimaiBudai"
          WHERE pavadinimas IN (SELECT "pirkimoBudas" FROM incoming)
          UNION ALL SELECT id, pavadinimas FROM inserted_methods
        ),
        inserted_plans AS (
          INSERT INTO public."planuojamiPirkimai" (
            md5, "vykdytojoId", "pirkimoPavadinimas", "pirkimoTipoId",
            "direktyvosId", "pirkimoBudoId", "bvpzKoduSkaicius"
          )
          SELECT
            i.md5, org.id, i."pirkimoPavadinimas", type.id,
            directive.id, method.id, cardinality(i."bvpzKodai")
          FROM incoming i
          LEFT JOIN all_organizations org
            ON org.pavadinimas = i."pirkimoVykdytojas"
          LEFT JOIN all_types type ON type.pavadinimas = i."pirkimoTipas"
          LEFT JOIN all_directives directive ON directive.pavadinimas = i.direktyva
          LEFT JOIN all_methods method ON method.pavadinimas = i."pirkimoBudas"
          ON CONFLICT (md5) DO NOTHING
          RETURNING id, md5
        ),
        target_plans AS MATERIALIZED (
          SELECT id, md5 FROM inserted_plans
          UNION ALL
          SELECT p.id, p.md5
          FROM public."planuojamiPirkimai" p
          JOIN incoming i ON i.md5 = p.md5
        ),
        inserted_details AS (
          INSERT INTO public."planuojamiPirkimaiDuomenys" (
            "pirkimoId", aprasymas, "bvpzKodaiRaw", "apskaiciuotaKaina",
            kiekiai, "pirkimoPradziosData", "pasiulymuTeikimoData",
            "numatomaSutartiesTrukmeMenesiais",
            "sutartiesTrukmesMatavimoVienetas",
            "preliminariPirkimoSukurimoData"
          )
          SELECT
            p.id, i.aprasymas, i."bvpzKodaiRaw", i."apskaiciuotaKaina",
            i.kiekiai, i."pirkimoPradziosData", i."pasiulymuTeikimoData",
            i."numatomaSutartiesTrukmeMenesiais",
            i."sutartiesTrukmesMatavimoVienetas",
            i."preliminariPirkimoSukurimoData"
          FROM inserted_plans p JOIN incoming i USING (md5)
          RETURNING "pirkimoId"
        ),
        inserted_cpv AS (
          INSERT INTO public."planuojamiPirkimaiBvpzKodai" ("pirkimoId", "bvpzKodas")
          SELECT p.id, code
          FROM inserted_plans p
          JOIN incoming i USING (md5)
          CROSS JOIN LATERAL unnest(COALESCE(i."bvpzKodai", ARRAY[]::text[])) code
          ON CONFLICT ("pirkimoId", "bvpzKodas") DO NOTHING
          RETURNING "pirkimoId"
        ),
        inserted_search AS (
          INSERT INTO public."planuojamiPirkimaiSearch" ("pirkimoId", "searchTsv")
          SELECT p.id,
            setweight(to_tsvector('simple', COALESCE(i."pirkimoPavadinimas", '')), 'A') ||
            setweight(to_tsvector('simple', concat_ws(' ', i."pirkimoVykdytojas", org."jarKodas")), 'B') ||
            setweight(to_tsvector('simple', concat_ws(' ', i.aprasymas,
              i."bvpzKodaiRaw", i."pirkimoTipas", i.direktyva, i."pirkimoBudas")), 'C')
          FROM inserted_plans p
          JOIN incoming i USING (md5)
          LEFT JOIN all_organizations org
            ON org.pavadinimas = i."pirkimoVykdytojas"
          RETURNING "pirkimoId"
        ),
        tracking AS (
          INSERT INTO public."planuojamiPirkimaiAtnaujinimai" ("pirkimoId")
          SELECT id FROM target_plans
          ON CONFLICT ("pirkimoId") DO UPDATE SET
            "paskutinioAptikimoData" =
              (now() AT TIME ZONE 'Europe/Vilnius')
          RETURNING "pirkimoId"
        )
        SELECT count(*)::integer AS count FROM tracking;
        `,
        [JSON.stringify(uniqueRecords)],
    );
    return rows[0]?.count ?? 0;
}

export async function updateRecentPlanuojamiPirkimai({
    now = new Date(),
    days = DEFAULT_DAYS,
    workingHours = isVptWorkingHours,
    processRecords = processPlanuojamiPirkimai,
    db = postgres,
    logger = defaultLogger,
} = {}) {
    if (workingHours()) {
        logger.log("[planai DB] VPT darbo laikas — atnaujinimas praleistas");
        return { skipped: true, total: 0, intervals: 0 };
    }

    const range = recentPublicationRange(now, days);
    logger.log(`[planai DB] Atnaujinamos ${range.from}–${range.to}`);
    const result = await processRecords({
        ...range,
        logger,
        onRecords: (records) => upsertPlanuojamiPirkimai(records, db),
    });
    return { skipped: false, ...result };
}

export async function backfillPlanuojamiPirkimai({
    db = postgres,
    processRecords = processPlanuojamiPirkimai,
    assertSchema = assertPlanuojamiPirkimaiSchema,
    logger = defaultLogger,
    ...scrapeOptions
} = {}) {
    await assertSchema(db);
    return processRecords({
        ...scrapeOptions,
        logger,
        onRecords: (records) => upsertPlanuojamiPirkimai(records, db),
    });
}

function cliOptions(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = argv[index + 1];
        if (argument === "--from") options.from = value, index += 1;
        else if (argument === "--to") options.to = value, index += 1;
        else if (argument === "--limit") options.limit = Number(value), index += 1;
        else if (argument === "--delay-ms") options.delayMs = Number(value), index += 1;
        else throw new Error(`Nežinomas argumentas: ${argument}`);
    }
    return options;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
    backfillPlanuojamiPirkimai(cliOptions(process.argv.slice(2)))
        .then(({ total, intervals }) => {
            log(
                `[planai DB] Baigta: ${total} šaltinio įrašų, ${intervals} CSV dalys`,
            );
        })
        .catch((error) => {
            log(error?.stack ?? String(error));
            process.exitCode = 1;
        })
        .finally(() => postgres.end());
}
