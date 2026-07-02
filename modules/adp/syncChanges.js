import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import appConfig from "../../utils/config.js";
const logger = new Logger();

/**
 * Sinchronizuoja bet kurį :changes dataset pagal CONFIG
 * @param {Object} CONFIG
 * @param {string} CONFIG.table - DB lentelė
 * @param {string} CONFIG.dataset - dataset path
 * @param {Object} CONFIG.mapping - API key -> DB stulpelis
 * @param {string[]} [CONFIG.columns] - DB stulpeliai, kuriuos rašyti į pagrindinę lentelę
 * @param {Function} [CONFIG.beforeApply] - optional hook prieš INSERT/PATCH/DELETE
 * @param {number} CONFIG.limit - batch limit
 * @returns {Promise<boolean>} - true jei dar yra duomenų, false jei pabaiga
 */
export async function syncAdpChanges(CONFIG) {
    const BASE = `${appConfig.dataGovUrl}/${CONFIG.dataset}/:changes`;

    async function getLastState() {
        const res = await postgres.query(
            `SELECT "lastCid", "lastId", "lastRevision" FROM "adpChanges" WHERE "dataset" = $1`,
            [CONFIG.dataset],
        );
        if (res.rowCount === 0)
            return { lastCid: 1, lastId: null, lastRevision: null };
        return res.rows[0];
    }

    async function saveState(cid, id, revision) {
        await postgres.query(
            `
            INSERT INTO "adpChanges"
                ("dataset","lastCid","lastId","lastRevision","lastCheckedAt")
            VALUES ($1,$2,$3,$4,now())
            ON CONFLICT ("dataset")
            DO UPDATE SET
                "lastCid" = EXCLUDED."lastCid",
                "lastId" = EXCLUDED."lastId",
                "lastRevision" = EXCLUDED."lastRevision",
                "lastCheckedAt" = now()
            `,
            [CONFIG.dataset, cid, id, revision],
        );
    }

    async function fetchChanges(fromCid) {
        const url = `${BASE}/${fromCid}?limit(${CONFIG.limit})`;
        logger.log(`Fetching changes from: ${url}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function applyInsert(rows) {
        if (!rows || rows.length === 0) return;

        const dbCols = CONFIG.columns ?? Object.values(CONFIG.mapping);
        const filteredRows = rows.filter((r) =>
            dbCols.some((col) => r[col] !== null && r[col] !== undefined),
        );
        if (!filteredRows.length) return;

        const values = [];
        const placeholders = filteredRows
            .map((row) => {
                const ph = dbCols.map((col) => {
                    values.push(row[col] ?? null);
                    return `$${values.length}`;
                });
                return `(${ph.join(",")})`;
            })
            .join(",");

        const sql = `
            INSERT INTO "${CONFIG.table}" (${dbCols.map((c) => `"${c}"`).join(",")})
            VALUES ${placeholders}
            ON CONFLICT DO NOTHING;
            `;

        await postgres.query(sql, values);
    }

    async function applyPatch(rows) {
        for (const r of rows) {
            const fields = [];
            const values = [];
            let i = 1;
            for (const [apiKey, dbCol] of Object.entries(CONFIG.mapping)) {
                if (apiKey === "_id") continue;
                if (CONFIG.columns && !CONFIG.columns.includes(dbCol)) continue;
                const val = r.patch[apiKey];
                if (val !== undefined) {
                    fields.push(`"${dbCol}" = $${i++}`);
                    values.push(val);
                }
            }
            if (!fields.length) continue;
            values.push(r._id);
            await postgres.query(
                `UPDATE "${CONFIG.table}" SET ${fields.join(", ")} WHERE "_id" = $${fields.length + 1}`,
                values,
            );
        }
    }

    async function applyDelete(ids) {
        if (!ids || !ids.length) return;
        await postgres.query(
            `DELETE FROM "${CONFIG.table}" WHERE "_id" = ANY($1)`,
            [ids],
        );
    }

    let state = await getLastState();
    let lastCid = state.lastCid;
    const data = await fetchChanges(lastCid);

    if (!data._data || data._data.length <= 1) {
        await saveState(lastCid, state.lastId, state.lastRevision);
        return false;
    }

    const inserts = [];
    const patches = [];
    const deletes = [];

    for (const c of data._data) {
        lastCid = Number(c._cid);

        if (c._op === "insert") {
            const rowObj = {};
            for (const [apiKey, dbCol] of Object.entries(CONFIG.mapping)) {
                if (apiKey.includes(".")) {
                    const [parent, child] = apiKey.split(".");
                    rowObj[dbCol] = c[parent]?.[child] ?? null;
                } else {
                    rowObj[dbCol] = c[apiKey] ?? null;
                }
            }
            inserts.push(rowObj);
        } else if (c._op === "patch") {
            const { _id, _op, _cid, _revision, _txn, _created, ...patch } = c;
            patches.push({ _id, patch });
        } else if (c._op === "delete") {
            deletes.push(c._id);
        }
    }

    logger.log(
        `${CONFIG.dataset} – Inserts: ${inserts.length}, patches: ${patches.length}, deletes: ${deletes.length}`,
    );
    if (CONFIG.beforeApply) {
        await CONFIG.beforeApply({ inserts, patches, deletes, postgres });
    }
    await applyInsert(inserts);
    await applyPatch(patches);
    await applyDelete(deletes);

    const last = data._data[data._data.length - 1];
    await saveState(lastCid, last._id, last._revision);

    return true;
}
