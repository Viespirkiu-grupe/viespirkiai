import { postgres } from "../../postgres/postgres.js";
import { drainIndexQueue, runShardedDrain } from "../../quickwit/indexQueueDrainer.js";
import { Logger } from "../../utils/log.js";
import { foldLithuanian } from "../../utils/text.js";
import { toRfc3339 } from "../../utils/time.js";
import { readDokumentasFs } from "./dokumentaiFs.js";
import { pathToFileURL } from "node:url";

const logger = new Logger();

const BATCH_SIZE = 500;
const LENTELE = "dokumentai";

/**
 * Nusausina vieną `dokumentaiIndexQueue` porciją į Quickwit.
 * Karkasas (tranzakcija, dedup, shard'inimas) — `quickwit/indexQueueDrainer.js`.
 *
 * @param {{ shard?: number, shardCount?: number }} [opts]
 * @returns {Promise<boolean>} `true`, jei buvo apdorota eilučių.
 */
export async function processDokumentaiIndexQueue(opts = {}) {
    return drainIndexQueue(
        {
            lentele: LENTELE,
            queueTable: "dokumentaiIndexQueue",
            keyColumn: "dokumentoId",
            batchSize: BATCH_SIZE,
            // „force" — dokumentų paieška turi pamatyti pakeitimą iš karto.
            commit: "force",
            rowId: (row) => row.id,
            buildDoc: async (row) => {
                const sidecar = row.md5 ? await readDokumentasFs(row.md5) : null;
                return buildDoc(row, sidecar);
            },
            fetchRows: async (client, ids) => {
                const { rows } = await client.query(
                    `SELECT
                        id, md5, class, type, parent,
                        host, domain, url, source, "istaigaJar",
                        "saltinioId0", "saltinioId1", "saltinioId2", "saltinioId3",
                        autorius AS author, pavadinimas AS title,
                        extension, "mimeType", language,
                        "pageCount", "wordCount", "characterCount",
                        savivaldybe, apskritis,
                        CASE WHEN location IS NULL THEN NULL ELSE ST_Y(location::geometry) END AS lat,
                        CASE WHEN location IS NULL THEN NULL ELSE ST_X(location::geometry) END AS lon,
                        "discoveredAt", "createdAt", "updatedAt", "happenedAt"
                     FROM public.dokumentai
                     WHERE id = ANY($1::bigint[])`,
                    [ids],
                );
                return rows;
            },
            logger,
        },
        opts,
    );
}

function buildDoc(row, sidecar) {
    // DB eilutė turi filtruojamus laukus, sidecar — didelius / masyvinius /
    // laisvos formos. Sidecar laimi, kai reikšmę turi abu (jis yra tiesos
    // šaltinis), DB eilutė užpildo, kai sidecar'o nėra arba jis nepilnas.
    const s = sidecar || {};
    return {
        id: row.id,
        version: s.version ?? null,
        md5: row.md5,
        class: row.class,
        type: row.type,
        parent: row.parent,

        host: row.host,
        domain: row.domain,
        url: row.url,
        source: row.source,
        istaigaJar: row.istaigaJar,

        saltinioId0: row.saltinioId0,
        saltinioId1: row.saltinioId1,
        saltinioId2: row.saltinioId2,
        saltinioId3: row.saltinioId3,

        jarKodai: s.jarKodai ?? [],
        phones: s.phones ?? [],
        emails: s.emails ?? [],
        iban: s.iban ?? [],
        domains: s.domains ?? [],

        author: s.author ?? row.author ?? null,
        title: s.title ?? row.title ?? null,

        extension: row.extension,
        mimeType: row.mimeType,
        metadata: s.metadata ?? null,
        language: row.language,
        pageCount: row.pageCount,
        wordCount: row.wordCount,
        characterCount: row.characterCount,

        text: s.text ? foldLithuanian(s.text) : null,

        savivaldybe: row.savivaldybe,
        apskritis: row.apskritis,
        lat: row.lat,
        lon: row.lon,

        discoveredAt: toRfc3339(row.discoveredAt),
        createdAt: toRfc3339(row.createdAt),
        // Quickwit reikalauja, kad timestamp_field (updatedAt) nebūtų null.
        // Nežinomam atvejui imam „dabar" — indeksavimo laikas yra tinkamas pakaitalas.
        updatedAt: toRfc3339(row.updatedAt) ?? new Date().toISOString(),
        happenedAt: toRfc3339(row.happenedAt),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await runShardedDrain({
        work: processDokumentaiIndexQueue,
        label: "dokumentai",
        logger,
    });
    await postgres.end();
    process.exit(0);
}
