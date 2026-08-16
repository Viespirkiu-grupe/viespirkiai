import { parseCSV } from "../../../utils/csv.js";
import { log } from "../../../utils/log.js";
import { mapJarAdditionalRow } from "./mapping.js";
import { writeBatch } from "./batches.js";
import { deleteSourceScope, saveImportMetadata } from "./scope.js";

const BATCH_SIZE = 1_000;

export async function importDownloadedSource(client, source, path, metadata) {
    await client.query("BEGIN");
    let scanned = 0;
    let stored = 0;
    let batch = [];
    let formavimoData = null;
    try {
        await deleteSourceScope(client, source);
        const mappingSource = { ...source };
        if (source.kind === "dokumentai") {
            const metadataDate = metadata.lastModified == null
                ? null
                : new Date(metadata.lastModified);
            if (metadataDate && !Number.isNaN(metadataDate.getTime())) {
                mappingSource.fallbackFormavimoData = metadataDate
                    .toISOString().slice(0, 10);
            } else {
                const { rows } = await client.query(
                    `SELECT current_date::text AS "formavimoData"`,
                );
                mappingSource.fallbackFormavimoData = rows[0].formavimoData;
            }
        }
        for await (const rawRow of parseCSV(path)) {
            const mapped = mapJarAdditionalRow(rawRow, mappingSource, scanned + 2);
            scanned++;
            for (const row of mapped) {
                batch.push(row);
                stored++;
                formavimoData = row.formavimoData ?? formavimoData;
            }
            if (batch.length >= BATCH_SIZE) {
                await writeBatch(client, source, batch);
                batch = [];
            }
            if (scanned % 100_000 === 0) {
                log(`${source.file}: perskaityta ${scanned} CSV eilučių`);
            }
        }
        if (batch.length) await writeBatch(client, source, batch);
        if (scanned === 0) {
            throw new Error(`${source.file}: CSV neturi duomenų eilučių`);
        }
        await saveImportMetadata(client, source, metadata, scanned, formavimoData);
        await client.query("COMMIT");
        log(`${source.file}: importuota ${scanned} CSV eilučių, ${stored} DB rodinių`);
        return { scanned, stored, formavimoData };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}

