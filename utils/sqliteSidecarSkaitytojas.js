// Vienas sidecar skaitymo darbininkas (žr. `utils/sqliteSidecarPoolas.js`).
//
// Turi savo readonly jungtį prie to paties failo — WAL leidžia daug skaitytojų
// lygiagrečiai. Darbininke atliekamas ir `json_each` ieškojimas, ir zstd
// dekompresija, tad pagrindinė gija lieka laisva: `node:sqlite` yra
// sinchroninis, o be gijų 50 atsitiktinių skaitymų blokuoja event loop'ą apie
// 100 ms (žr. `benchmarks/sidecarSkaitymas.js`).

import { promisify } from "node:util";
import zlib from "node:zlib";
import { parentPort, workerData } from "node:worker_threads";
import { openSqlite } from "./sqlite.js";
import { quoteIdentifier } from "./sqliteSidecarStore.js";

const zstdDecompress = promisify(zlib.zstdDecompress);
const { dbPath, table, keyColumn, cacheSize } = workerData;

const lentele = quoteIdentifier(table);
const raktas = quoteIdentifier(keyColumn);

// Puslapių cache mažesnis nei numatytasis: gijų yra kelios, o kiekviena jungtis
// turi SAVO cache. Su numatytuoju (~256 MB) aštuonios gijos pasiimtų ~2 GB.
const db = openSqlite({ dbPath, readonly: true, pragmas: { cacheSize } });

const readMany = db.prepare(
    `SELECT ${raktas} AS "raktas", "turinys" FROM ${lentele}
     WHERE ${raktas} IN (SELECT value FROM json_each(?))`,
);

parentPort.on("message", async ({ id, keys }) => {
    try {
        const rows = readMany.all(JSON.stringify(keys));
        const tekstai = await Promise.all(rows.map((row) => zstdDecompress(row.turinys)));
        // Masyvas porų, ne Map — per structured clone pigiau ir paprasčiau.
        parentPort.postMessage({
            id,
            poros: rows.map((row, i) => [row.raktas, tekstai[i].toString("utf8")]),
        });
    } catch (error) {
        parentPort.postMessage({ id, klaida: error?.stack || String(error) });
    }
});
