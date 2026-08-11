import { postgres } from "../../postgres/postgres.js";
import { numArg, parseArgs } from "../../utils/cliArgs.js";

const DEFAULT_BATCH = 10_000;

export async function auditETarDokumentai() {
    const { rows: [row] } = await postgres.query(
        `SELECT
            (SELECT count(*) FROM public."eTarLegalActDocument") AS "eTarViso",
            (SELECT count(*) FROM public.dokumentai
              WHERE class = 'teisekura' AND source = 'etar') AS "dokumentaiViso",
            (SELECT count(*)
               FROM public."eTarLegalActDocument" e
               LEFT JOIN public.dokumentai d
                 ON d.class = 'teisekura' AND d.source = 'etar'
                AND d."saltinioId2" = e."documentId"::text
              WHERE d.id IS NULL) AS truksta,
            (SELECT count(*)
               FROM public."eTarLegalActDocument" e
               JOIN public.dokumentai d
                 ON d.class = 'teisekura' AND d.source = 'etar'
                AND d."saltinioId2" = e."documentId"::text
              WHERE d.md5 IS DISTINCT FROM e.md5) AS pasene,
            (SELECT count(*)
               FROM public.dokumentai d
               LEFT JOIN public."eTarLegalActDocument" e
                 ON e."documentId"::text = d."saltinioId2"
              WHERE d.class = 'teisekura' AND d.source = 'etar'
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
