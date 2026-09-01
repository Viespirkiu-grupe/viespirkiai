import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { TIPO_ID } from "./viesiejiPirkimaiEnums.js";

const TIPO_PAVADINIMAS = Object.fromEntries(
    Object.entries(TIPO_ID).map(([type, typeId]) => [typeId, type]),
);

/**
 * Clears stuck reservation flags (turinioNuskaitymas = -2) for CfTWS/CfTDPSWS/Pmc
 * that have been reserved longer than maxAgeMinutes without completion.
 *
 * @param {object} [options]
 * @param {number} [options.maxAgeMinutes=60] - How old the reservation must be to reset.
 * @param {string[]} [options.types=["CfTWS","CfTDPSWS","Pmc"]] - Types to clean.
 * @returns {Promise<object>} Counts of cleaned rows per type and total.
 */
export async function cleanReservations({
    maxAgeMinutes = 60,
    types = ["CfTWS", "CfTDPSWS", "Pmc"],
} = {}) {
    if (!Array.isArray(types) || types.length === 0) {
        return { total: 0, perType: {} };
    }

    const typeIds = types
        .map((type) => TIPO_ID[type])
        .filter((typeId) => typeId !== undefined);

    if (typeIds.length === 0) {
        return { total: 0, perType: {} };
    }

    const { rows } = await postgres.query(
        `
        WITH reset AS (
            UPDATE "eppsViesiejiPirkimai"."atnaujinimai" v
            SET "turinioNuskaitymas" = -1,
                "scrapeReservation" = NULL
            WHERE v."typeId" = ANY($1::int[])
              AND v."turinioNuskaitymas" = -2
              AND v."scrapeReservation" <= (now() AT TIME ZONE 'Europe/Vilnius') - ($2 || ' minutes')::interval
            RETURNING v."typeId"
        )
        SELECT "typeId", COUNT(*)::int AS count
        FROM reset
        GROUP BY "typeId"
        `,
        [typeIds, String(maxAgeMinutes)],
    );

    const perType = Object.fromEntries(
        rows.map((r) => [TIPO_PAVADINIMAS[r.typeId], Number(r.count)]),
    );
    const total = rows.reduce((acc, r) => acc + Number(r.count), 0);

    if (total > 0) {
        log(
            `cleanReservations: cleared ${total} stuck reservations | ` +
                types.map((t) => `${t}=${perType[t] ?? 0}`).join(" "),
        );
    }

    return { total, perType };
}

/** TaskRunner adapter: retry immediately only when the cleanup changed rows. */
export async function cleanReservationsHasMore(options) {
    return (await cleanReservations(options)).total > 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        try {
            let result = await cleanReservations();
            log(`Finished cleaning reservations: ${result.total} total`);
            for (const [type, count] of Object.entries(result.perType)) {
                log(`  ${type}: ${count}`);
            }
        } finally {
            await postgres.end();
        }
    })();
}
