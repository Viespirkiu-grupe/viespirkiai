import { pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";
import {
    downloadJarSource,
    fetchJarMetadata,
    importJarCsv,
    SOURCES,
} from "./importJarCsv.js";
import { syncJuridiniaiDictionaries } from "./syncDictionaries.js";

async function lastSuccessful(file, db) {
    const { rows } = await db.query(
        `SELECT "etag", "lastModified", "size", "sha256"
         FROM "rcJar"."csvAtnaujinimai"
         WHERE "failas" = $1 AND "busena" = 'importuota'
         ORDER BY "id" DESC LIMIT 1`,
        [file],
    );
    return rows[0] ?? null;
}

export function metadataUnchanged(previous, current) {
    if (!previous) return false;
    if (current.etag && previous.etag) return current.etag === previous.etag;
    if (current.lastModified && previous.lastModified) {
        return new Date(current.lastModified).getTime() ===
            new Date(previous.lastModified).getTime() &&
            (current.size == null || previous.size == null ||
                Number(previous.size) === Number(current.size));
    }
    return false;
}

async function recordCheck(file, status, values, db) {
    await db.query(
        `INSERT INTO "rcJar"."csvAtnaujinimai"
            ("failas", "busena", "etag", "lastModified", "size", "sha256",
             "eiluciuSkaicius", "pakeistuSkaicius")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [file, status, values.etag, values.lastModified, values.size,
            values.sha256 ?? null, values.scanned ?? null, values.changed ?? null],
    );
}

export async function atnaujintiJarCsv({ force = false } = {}, db = postgres) {
    const pending = [];
    const workDir = await mkdtemp(join(tmpdir(), "jar-csv-"));
    try {
        for (const source of SOURCES) {
            let metadata;
            try {
                metadata = await fetchJarMetadata(source);
            } catch (error) {
                await recordCheck(source.file, "klaida", {}, db);
                throw error;
            }
            const previous = await lastSuccessful(source.file, db);
            if (!force && metadataUnchanged(previous, metadata)) {
                await recordCheck(source.file, "nepakito", metadata, db);
                log(`JAR ${source.file} nepakito — nesiunčiama`);
                continue;
            }

            const localPath = join(workDir, source.file);
            let downloaded;
            try {
                downloaded = await downloadJarSource(source, localPath);
            } catch (error) {
                await recordCheck(source.file, "klaida", metadata, db);
                throw error;
            }
            if (!force && previous?.sha256 === downloaded.sha256) {
                await recordCheck(source.file, "turinys-nepakito", downloaded, db);
                log(`JAR ${source.file} turinys nepakito — neimportuojama`);
                continue;
            }
            pending.push({
                ...source,
                localPath,
                sha256: downloaded.sha256,
                downloadMetadata: downloaded,
            });
        }

        let changed = 0;
        if (pending.length) {
            await importJarCsv({
                sources: pending,
                afterSource: async (source, result, client) => {
                    await recordCheck(source.file, "importuota", result, client);
                    changed += result.changed;
                },
                onSourceError: async (source, _error, client) => {
                    await recordCheck(source.file, "klaida", {}, client);
                },
            });
            await syncJuridiniaiDictionaries(db, "jar-csv-dictionaries");
        }

        if (changed > 0) {
            signalWork(WORK_SIGNALS.JURIDINIAI_REFRESH_READY, {
                source: "jar-csv",
                count: changed,
            });
        }
        return { checked: SOURCES.length, imported: pending.length, changed };
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const result = await atnaujintiJarCsv({
            force: process.argv.slice(2).includes("--force"),
        });
        console.log(result);
    } finally {
        await postgres.end();
    }
}
