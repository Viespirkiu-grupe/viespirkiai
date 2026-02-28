import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

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

    const { rows } = await postgres.query(
        `
        WITH reset AS (
            UPDATE public."viesiejiPirkimai" v
            SET "turinioNuskaitymas" = -1,
                "scrapeReservation" = NULL
            WHERE v.type = ANY($1)
              AND v."turinioNuskaitymas" = -2
              AND v."scrapeReservation" <= (now() AT TIME ZONE 'Europe/Vilnius') - ($2 || ' minutes')::interval
            RETURNING v.type
        )
        SELECT type, COUNT(*)::int AS count
        FROM reset
        GROUP BY type
        `,
        [types, String(maxAgeMinutes)],
    );

    const perType = Object.fromEntries(
        rows.map((r) => [r.type, Number(r.count)]),
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

if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        try {
            const result = await cleanReservations();
            console.log(JSON.stringify(result));
        } finally {
            await postgres.end();
        }
    })();
}
