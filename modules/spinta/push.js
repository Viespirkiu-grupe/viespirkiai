/**
 * Higher-level helpers for streaming records into Spinta in batches.
 */

/**
 * Push records to a model in NDJSON batches.
 *
 * @param {object}   client     A client from createSpintaClient().
 * @param {string}   model      Model name (or full path).
 * @param {Iterable|AsyncIterable} records Records to push.
 * @param {object}   [options]
 * @param {"insert"|"upsert"|"patch"|"delete"|"update"} [options.op="upsert"]
 * @param {number}   [options.batchSize=500]
 * @param {(row)=>object} [options.toOp] Custom op-builder. Default wraps the row with `_op`.
 * @param {(progress)=>void} [options.onProgress] Called after each batch with {sent, batches, errors}.
 * @returns {Promise<{sent:number, batches:number, errors:Array}>}
 */
export async function pushBatches(client, model, records, options = {}) {
    const op = options.op ?? "upsert";
    const batchSize = options.batchSize ?? 500;
    const toOp = options.toOp ?? ((row) => ({ _op: op, ...row }));

    const stats = { sent: 0, batches: 0, errors: [] };
    let buffer = [];

    async function flush() {
        if (!buffer.length) return;
        const ops = buffer.map(toOp);
        buffer = [];
        const result = await client.batch(model, ops);
        stats.batches++;
        stats.sent += ops.length;

        const rows = Array.isArray(result?._data) ? result._data : [];
        for (const r of rows) {
            if (r?._errors?.length) stats.errors.push(...r._errors);
        }
        if (options.onProgress) options.onProgress({ ...stats });
    }

    for await (const row of records) {
        buffer.push(row);
        if (buffer.length >= batchSize) await flush();
    }
    await flush();

    return stats;
}
