import { postgres } from "../../postgres/postgres.js";
import { numArg, parseArgs } from "../../utils/cliArgs.js";

const DEFAULT_BATCH = 10_000;

export async function auditETarDokumentai() {
    const { rows: [row] } = await postgres.query(
        `SELECT
            (SELECT count(*) FROM public."eTarLegalActDocument") AS "eTarViso",
            (SELECT count(*) FROM documents."sourceIds" si
              WHERE si."sourceId" = documents.source_id('etar')) AS "dokumentaiViso",
            (SELECT count(*)
               FROM public."eTarLegalActDocument" e
               LEFT JOIN documents."sourceIds" si
                 ON si."sourceId" = documents.source_id('etar')
                AND si.id2 = e."documentId"::text
              WHERE si."documentId" IS NULL) AS truksta,
            (SELECT count(*)
               FROM public."eTarLegalActDocument" e
               JOIN documents."sourceIds" si
                 ON si."sourceId" = documents.source_id('etar')
                AND si.id2 = e."documentId"::text
               JOIN documents.documents d ON d.id = si."documentId"
              WHERE d.md5 IS DISTINCT FROM decode(e.md5, 'hex')) AS pasene,
            (SELECT count(*)
               FROM documents."sourceIds" si
               LEFT JOIN public."eTarLegalActDocument" e
                 ON e."documentId"::text = si.id2
              WHERE si."sourceId" = documents.source_id('etar')
                AND e."documentId" IS NULL) AS naslaiciai`,
    );
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

export async function enqueueETarDokumentai({ after = 0, limit = Infinity, batch = DEFAULT_BATCH } = {}) {
    let cursor = Number(after) || 0;
    let queued = 0;
    while (queued < limit) {
        const take = Math.min(batch, limit - queued);
        const { rows } = await postgres.query(
            `WITH source AS (
                SELECT "documentId"
                FROM public."eTarLegalActDocument"
                WHERE "documentId" > $1
                ORDER BY "documentId"
                LIMIT $2
             ), queued AS (
                INSERT INTO public."eTarDocumentsQueue" ("documentId", change)
                SELECT "documentId", 'insert' FROM source
                RETURNING "documentId"
             )
             SELECT "documentId" FROM source ORDER BY "documentId"`,
            [cursor, take],
        );
        if (!rows.length) break;
        cursor = Number(rows.at(-1).documentId);
        queued += rows.length;
        console.log(`e-TAR → dokumentai: eilėje ${queued}, paskutinis documentId=${cursor}`);
    }
    return { queued, lastDocumentId: cursor };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = parseArgs(process.argv.slice(2));
    if (args.audit) {
        console.log(await auditETarDokumentai());
    } else {
        await enqueueETarDokumentai({
            after: numArg(args.after, 0),
            limit: numArg(args.limit, Infinity),
            batch: numArg(args.batch, DEFAULT_BATCH),
        });
    }
    await postgres.end();
    process.exit(0);
}
