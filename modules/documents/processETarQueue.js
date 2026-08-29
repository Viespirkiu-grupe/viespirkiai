import { postgres } from "../../postgres/postgres.js";
import { readETarSidecarMany } from "../eTar/eTarSidecar.js";
import { Logger } from "../../utils/log.js";
import {
    buildETarDokumentas,
    deleteETarDocuments,
    upsertETarBatch,
} from "./upsertFromETar.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

const logger = new Logger();
const BATCH_SIZE = 500;

export async function processETarDocumentsQueue() {
    const client = await postgres.connect();
    try {
        await client.query("BEGIN");
        const { rows: queue } = await client.query(
            `SELECT id, "documentId", change AS keitimas
             FROM public."eTarDocumentsQueue"
             ORDER BY id
             LIMIT $1
             FOR UPDATE SKIP LOCKED`,
            [BATCH_SIZE],
        );
        if (!queue.length) {
            await client.query("COMMIT");
            return false;
        }

        const priority = { delete: 0, patch: 1, insert: 2 };
        const deduped = new Map();
        for (const row of queue) {
            const key = String(row.documentId);
            const existing = deduped.get(key);
            if (!existing || priority[row.keitimas] < priority[existing]) {
                deduped.set(key, row.keitimas);
            }
        }
        const toDelete = [...deduped].filter(([, change]) => change === "delete").map(([id]) => id);
        const toUpsert = [...deduped].filter(([, change]) => change !== "delete").map(([id]) => id);

        let deleted = await deleteETarDocuments(toDelete, client);
        let upserted = 0;
        let skipped = 0;

        if (toUpsert.length) {
            const { rows } = await client.query(
                `SELECT d."documentId", d."legalActId", d.md5, d."sourceUrl", d.title,
                        d."editionToken", d."fetchedAt", v.code AS variantas,
                        p.code AS "turinioBusena"
                 FROM public."eTarLegalActDocument" d
                 JOIN public."eTarDocumentVariant" v USING ("documentVariantId")
                 JOIN public."eTarPresenceState" p
                   ON p."presenceStateId" = d."contentPresenceId"
                 WHERE d."documentId" = ANY($1::bigint[])`,
                [toUpsert],
            );
            const found = new Set(rows.map((row) => String(row.documentId)));
            const vanished = toUpsert.filter((id) => !found.has(String(id)));
            deleted += await deleteETarDocuments(vanished, client);

            // Visa partija vienu skaitymu: eilučių čia iki BATCH_SIZE, o ciklas
            // sukasi atviroje tranzakcijoje su FOR UPDATE SKIP LOCKED — kuo
            // trumpiau ją laikom, tuo mažiau blokuojam kitus darbininkus.
            const sidecarai = await readETarSidecarMany(
                rows.map((row) => row.md5).filter(Boolean),
            );

            const built = [];
            for (const row of rows) {
                const payload = row.md5 ? sidecarai.get(row.md5) : null;
                if (!payload) {
                    skipped++;
                    continue;
                }
                built.push(buildETarDokumentas(row, payload));
            }
            const result = await upsertETarBatch(built, client);
            upserted = result.upserted;
            skipped += result.skipped;
        }

        await client.query(
            `DELETE FROM public."eTarDocumentsQueue" WHERE id = ANY($1::bigint[])`,
            [queue.map((row) => row.id)],
        );
        await client.query("COMMIT");
        if (upserted + deleted > 0) {
            signalWork(WORK_SIGNALS.DOCUMENTS_INDEX_READY, {
                source: "eTarDocumentsQueue",
                count: upserted + deleted,
            });
        }
        logger.log(
            `eTarDocumentsQueue: paimta ${queue.length} (unikalių ${deduped.size}) | ` +
            `įrašyta ${upserted} | praleista ${skipped} | ištrinta ${deleted}`,
        );
        return true;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    while (await processETarDocumentsQueue()) {}
    await postgres.end();
    process.exit(0);
}
