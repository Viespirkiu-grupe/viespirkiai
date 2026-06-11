import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

export async function auditTeisekuraCoverage() {
    const { rows } = await postgres.query(
        `SELECT
            source,
            kind,
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE "scrapeState" > 0)::bigint AS ready,
            COUNT(*) FILTER (WHERE "scrapeState" = 0)::bigint AS pending,
            COUNT(*) FILTER (WHERE "scrapeState" < 0)::bigint AS failed,
            COUNT(*) FILTER (WHERE md5 IS NULL)::bigint AS without_document
         FROM public."teisekuraObjektai"
         GROUP BY source, kind
         ORDER BY source, kind`,
    );
    for (const row of rows) {
        log(`${row.source}/${row.kind}: ${row.ready}/${row.total} paruošta, ${row.pending} laukia, ${row.failed} klaidų, ${row.without_document} be dokumento`);
    }
    return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await auditTeisekuraCoverage();
    await postgres.end();
}
