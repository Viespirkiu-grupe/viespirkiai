import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSessionLock } from "../../../postgres/sessionLock.js";
import { postgres } from "../../../postgres/postgres.js";
import { log } from "../../../utils/log.js";
import { getJarAdditionalDataSources } from "../jarPapildomiDataSources.js";
import { downloadSource, fetchMetadata, metadataUnchanged } from "./source.js";
import { previousImport, saveImportMetadata } from "./scope.js";
import { importDownloadedSource } from "./importFile.js";

const LOCK_KEY = "jar-rc-additional-import";

export async function atnaujintiJarPapildomusDuomenis(
    { force = false, sources: suppliedSources } = {},
    db = postgres,
) {
    const lock = await acquireSessionLock(LOCK_KEY);
    if (!lock) throw new Error("Kitas papildomų RC JAR duomenų importas jau veikia");

    const workDir = await mkdtemp(join(tmpdir(), "jar-rc-extra-"));
    const result = { checked: 0, downloaded: 0, imported: 0, unchanged: 0, rows: 0 };
    try {
        const sources = suppliedSources ?? await getJarAdditionalDataSources();
        for (const source of sources) {
            result.checked++;
            const previous = await previousImport(source.file, db);
            const head = await fetchMetadata(source);
            if (!force && metadataUnchanged(previous, head)) {
                result.unchanged++;
                log(`${source.file}: nepakito`);
                continue;
            }

            const localPath = join(workDir, source.file);
            log(`${source.file}: siunčiama`);
            const downloaded = await downloadSource(source, localPath);
            result.downloaded++;
            if (!force && previous?.sha256 && previous.sha256 === downloaded.sha256) {
                await saveImportMetadata(
                    db, source, downloaded,
                    Number(previous.eiluciuSkaicius ?? 0),
                    previous.formavimoData,
                );
                result.unchanged++;
                log(`${source.file}: SHA-256 nepakito`);
                continue;
            }

            const client = typeof db.connect === "function" ? await db.connect() : db;
            let imported;
            try {
                imported = await importDownloadedSource(
                    client, source, localPath, downloaded,
                );
            } finally {
                if (client !== db) client.release();
            }
            result.imported++;
            result.rows += imported.scanned;
        }
        return result;
    } finally {
        await rm(workDir, { recursive: true, force: true });
        await lock.release();
    }
}

