import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { findSingleJuridinis } from "../juridiniai/search.js";
import { isVptWorkingHours } from "../sutartys/isWorkingHours.js";

const JAR_NUSKAITYMO_VERSIJA = 1;
const defaultLogger = { log, error: log };

async function reserveVykdytojas(db) {
    const { rows } = await db.query(
        `
        WITH candidate AS (
          SELECT v.id
          FROM public."planuojamiPirkimaiVykdytojai" v
          JOIN public."planuojamiPirkimaiVykdytojaiAtnaujinimai" a
            ON a."vykdytojoId" = v.id
          WHERE a."jarNuskaitymoVersija" IS NULL
             OR (a."jarNuskaitymoVersija" >= 0
                 AND a."jarNuskaitymoVersija" < $1)
             OR (a."jarNuskaitymoVersija" = -1
                 AND a."jarNuskaitymoData" <=
                   (now() AT TIME ZONE 'Europe/Vilnius') - interval '30 days')
             OR (a."jarNuskaitymoVersija" = -2
                 AND a."jarNuskaitymoData" <=
                   (now() AT TIME ZONE 'Europe/Vilnius') - interval '1 hour')
             OR (a."jarNuskaitymoVersija" >= $1
                 AND a."jarNuskaitymoData" <=
                   (now() AT TIME ZONE 'Europe/Vilnius') - interval '30 days')
          ORDER BY a."jarNuskaitymoData" ASC NULLS FIRST
          FOR UPDATE OF a SKIP LOCKED
          LIMIT 1
        )
        UPDATE public."planuojamiPirkimaiVykdytojaiAtnaujinimai" a
        SET "jarNuskaitymoVersija" = -2,
            "jarNuskaitymoData" =
              (now() AT TIME ZONE 'Europe/Vilnius')
        FROM candidate c
        JOIN public."planuojamiPirkimaiVykdytojai" v ON v.id = c.id
        WHERE a."vykdytojoId" = c.id
        RETURNING
          v.id,
          v.pavadinimas,
          v."jarKodas",
          COALESCE(
            v."jarKodas",
            (
              SELECT known."jarKodas"
              FROM public."viesiejiPirkimaiVykdytojai" known
              WHERE known.pavadinimas = v.pavadinimas
                AND known."jarKodas" IS NOT NULL
              ORDER BY known."nuskaitymoData" DESC NULLS LAST
              LIMIT 1
            )
          ) AS "cachedJarKodas";
        `,
        [JAR_NUSKAITYMO_VERSIJA],
    );
    return rows[0] ?? null;
}

async function refreshSearchForVykdytojas(vykdytojoId, db) {
    await db.query(
        `
        UPDATE public."planuojamiPirkimaiSearch" search
        SET "searchTsv" =
          setweight(to_tsvector('simple', COALESCE(p."pirkimoPavadinimas", '')), 'A') ||
          setweight(to_tsvector('simple', concat_ws(' ', v.pavadinimas, v."jarKodas")), 'B') ||
          setweight(to_tsvector('simple', concat_ws(' ', d.aprasymas,
            d."bvpzKodaiRaw", type.pavadinimas, directive.pavadinimas,
            method.pavadinimas)), 'C')
        FROM public."planuojamiPirkimai" p
        LEFT JOIN public."planuojamiPirkimaiDuomenys" d
          ON d."pirkimoId" = p.id
        LEFT JOIN public."planuojamiPirkimaiVykdytojai" v
          ON v.id = p."vykdytojoId"
        LEFT JOIN public."planuojamiPirkimaiTipai" type
          ON type.id = p."pirkimoTipoId"
        LEFT JOIN public."planuojamiPirkimaiDirektyvos" directive
          ON directive.id = p."direktyvosId"
        LEFT JOIN public."planuojamiPirkimaiBudai" method
          ON method.id = p."pirkimoBudoId"
        WHERE search."pirkimoId" = p.id
          AND p."vykdytojoId" = $1;
        `,
        [vykdytojoId],
    );
}

export async function processNextPlanuojamuPirkimuVykdytojas({
    db = postgres,
    findJuridinis = findSingleJuridinis,
    workingHours = isVptWorkingHours,
    logger = defaultLogger,
} = {}) {
    if (workingHours()) return false;
    const vykdytojas = await reserveVykdytojas(db);
    if (!vykdytojas) return false;

    try {
        const juridinis = vykdytojas.cachedJarKodas
            ? null
            : await findJuridinis(vykdytojas.pavadinimas);
        const jarKodas =
            vykdytojas.cachedJarKodas ?? juridinis?.jarKodas ?? null;
        await db.query(
            `
            WITH updated_organization AS (
              UPDATE public."planuojamiPirkimaiVykdytojai"
              SET "jarKodas" = COALESCE($2, "jarKodas")
              WHERE id = $1
              RETURNING id
            )
            UPDATE public."planuojamiPirkimaiVykdytojaiAtnaujinimai"
            SET "jarNuskaitymoVersija" = $3,
                "jarNuskaitymoData" =
                  (now() AT TIME ZONE 'Europe/Vilnius')
            WHERE "vykdytojoId" IN (
              SELECT id FROM updated_organization
            );
            `,
            [vykdytojas.id, jarKodas, JAR_NUSKAITYMO_VERSIJA],
        );
        if (jarKodas) await refreshSearchForVykdytojas(vykdytojas.id, db);
        logger.log(
            `[planai JAR] ${vykdytojas.pavadinimas} → ${jarKodas ?? "nerasta"}`,
        );
    } catch (error) {
        await db.query(
            `
            UPDATE public."planuojamiPirkimaiVykdytojaiAtnaujinimai"
            SET "jarNuskaitymoVersija" = -1,
                "jarNuskaitymoData" =
                  (now() AT TIME ZONE 'Europe/Vilnius')
            WHERE "vykdytojoId" = $1;
            `,
            [vykdytojas.id],
        );
        logger.error?.(
            `[planai JAR] ${vykdytojas.pavadinimas}: ${error.message}`,
        );
    }
    return true;
}
