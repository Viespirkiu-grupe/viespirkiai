import { searchAll as quickwitSearchAll } from "../../../quickwit/quickwit.js";
import {
    buildSutartysQuickwitQuery,
    QUICKWIT_EXPORT_WINDOW,
    QUICKWIT_LENTELE,
    SUTARTYS_EXPORT_LIMIT,
} from "./quickwitQuery.js";
import { aptvarkytiRezultata, loadSearchRowsFromPostgres } from "./rows.js";

/**
 * Iterates a large Quickwit export without deep offsets. Each 5k window is
 * sorted by the unique contract ID; the next query starts strictly after the
 * final raw Quickwit hit, so tombstones at a window boundary cannot skip rows.
 * @param {object} query
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {AbortSignal} [options.signal]
 * @param {(progress: {processed: number}) => void} [options.onBatch]
 */
export async function* iterateSutartysQuickwitExport(
    query,
    { limit = SUTARTYS_EXPORT_LIMIT, signal, onBatch } = /** @type {any} */ ({}),
) {
    const baseQuery = buildSutartysQuickwitQuery(query);
    let afterId = null;
    let processed = 0;

    while (processed < limit) {
        if (signal?.aborted) throw new DOMException("Exportas atšauktas", "AbortError");
        const cursorQuery = afterId == null
            ? baseQuery
            : `(${baseQuery}) AND sutartiesUnikalusId:{${afterId} TO *]`;
        const result = await quickwitSearchAll(
            QUICKWIT_LENTELE,
            { query: cursorQuery, sort_by: "-sutartiesUnikalusId" },
            {
                limit: Math.min(QUICKWIT_EXPORT_WINDOW, limit - processed),
                pageSize: Math.min(QUICKWIT_EXPORT_WINDOW, limit - processed),
                maxPages: 1,
            },
        );
        const rawCursor = Number(result.lastRawHit?.sutartiesUnikalusId);
        const rows = await loadSearchRowsFromPostgres(
            result.hits.map((hit) => ({ id: hit.sutartiesUnikalusId })),
        );

        for (const row of rows) {
            if (processed >= limit) return;
            processed++;
            yield aptvarkytiRezultata(row);
        }
        onBatch?.({ processed });

        if (!Number.isSafeInteger(rawCursor) || rawCursor === afterId || result.rawExhausted) return;
        afterId = rawCursor;
    }
}

