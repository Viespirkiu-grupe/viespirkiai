#!/usr/bin/env node

/** Compatibility facade for the split additional JAR data importer. */
import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { atnaujintiJarPapildomusDuomenis } from "./jarAdditionalImport/orchestrator.js";

export { metadataUnchanged } from "./jarAdditionalImport/source.js";
export { mapJarAdditionalRow } from "./jarAdditionalImport/mapping.js";
export { writeBatch } from "./jarAdditionalImport/batches.js";
export { importDownloadedSource } from "./jarAdditionalImport/importFile.js";
export { atnaujintiJarPapildomusDuomenis } from "./jarAdditionalImport/orchestrator.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const result = await atnaujintiJarPapildomusDuomenis({
            force: process.argv.slice(2).includes("--force"),
        });
        console.log(result);
    } finally {
        await postgres.end();
    }
}
