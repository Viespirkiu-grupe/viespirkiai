import { performance } from "node:perf_hooks";

// Keyset („seek") paginacija: einam `WHERE raktas > $cursor ORDER BY raktas LIMIT $n`,
// be OFFSET – kitaip gale kiekvienas puslapis kainuoja vis brangiau. Tą patį ciklą
// (kursorius, „ar dar yra", prefetch) rašė kiekvienas masinis darbas atskirai.

/**
 * @template T
 * @param {(cursor: any, pageSize: number) => Promise<T[]>} fetchPage
 *   Turi grąžinti ne daugiau `pageSize` eilučių, surūšiuotų didėjančia rakto tvarka,
 *   ir tik tas, kurių raktas > `cursor` (kai `cursor` nėra null).
 * @param {Object} opts
 * @param {number} opts.pageSize
 * @param {any} [opts.startAfter] - nuo kur tęsti (null = nuo pradžių)
 * @param {(row: T) => any} [opts.getCursor] - kaip iš eilutės paimti raktą
 * @param {boolean} [opts.prefetch] - kitą puslapį traukti dar apdorojant dabartinį
 * @returns {AsyncGenerator<{rows: T[], pgMs: number, cursor: any}>}
 */
export async function* keysetPages(
    fetchPage,
    { pageSize, startAfter = null, getCursor = (row) => row.id, prefetch = false } = {},
) {
    async function timedFetch(cursor) {
        const t0 = performance.now();
        const rows = await fetchPage(cursor, pageSize);
        return { rows, pgMs: performance.now() - t0 };
    }

    let cursor = startAfter;
    let pending = timedFetch(cursor);

    for (;;) {
        const { rows, pgMs } = await pending;
        if (rows.length === 0) return;

        const more = rows.length === pageSize;
        cursor = getCursor(rows[rows.length - 1]);

        // Su prefetch'u kita užklausa persidengia su dabartinio puslapio apdorojimu.
        pending = more && prefetch ? timedFetch(cursor) : null;

        yield { rows, pgMs, cursor };
        if (!more) return;
        if (!pending) pending = timedFetch(cursor);
    }
}
