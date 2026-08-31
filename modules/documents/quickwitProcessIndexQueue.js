import { postgres } from "../../postgres/postgres.js";
import { drainIndexQueue, runShardedDrain } from "../../quickwit/indexQueueDrainer.js";
import { Logger } from "../../utils/log.js";
import { foldLithuanian } from "../../utils/text.js";
import { toRfc3339 } from "../../utils/time.js";
import { readDocumentFs, readDocumentsFs } from "./documentsFs.js";
import { buildGeo } from "../../quickwit/morton.js";
import { DOCUMENTS_QUICKWIT_INDEX_CONFIG } from "./quickwitIndexConfig.js";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const logger = new Logger();

const BATCH_SIZE = 500;

const LENTELE = "documents";
let configRegistered = false;

/*
Quickwit commit režimas.

Numatyta „auto" – kaip ir kituose keturiuose indeksuose (juridiniai, sutartys,
viesiejiPirkimai, mcp). Pasikliaunam indekso `commit_timeout_secs: 15`.

Anksčiau čia buvo „force", kad pakeistas dokumentas paieškoje matytųsi iš karto.
Kaina pasirodė didelė: „force" verčia Quickwit prie KIEKVIENO kreipinio užbaigti
split-ą ir paskelbti jį metastore-e, o tai laukimas, ne skaičiavimas – matavimo
metu `ingest` trukdavo 3,5 s, nors Quickwit naudojo vos ~1,5 branduolio iš 20 ir
sistema buvo 86 % laisva.

Mainai, kuriuos tai reiškia: pakeitimas paieškoje pasirodo ne akimirksniu, o iki
15 s vėliau. Kam prireiks senojo elgesio – `--commit force` arba
DOCUMENTS_INDEX_COMMIT=force.
*/
const COMMIT_MODES = new Set(["auto", "force", "wait_for"]);

export function parseCommitMode(argv = process.argv.slice(2), env = process.env) {
    for (let i = 0; i < argv.length; i++) {
        const match = argv[i].match(/^--commit=(.+)$/);
        const value = match ? match[1] : (argv[i] === "--commit" ? argv[i + 1] : null);
        if (value) {
            if (!COMMIT_MODES.has(value)) {
                throw new Error(`Netinkamas --commit: ${value} (galimi: ${[...COMMIT_MODES].join(", ")})`);
            }
            return value;
        }
    }
    const fromEnv = env.DOCUMENTS_INDEX_COMMIT;
    if (fromEnv) {
        if (!COMMIT_MODES.has(fromEnv)) {
            throw new Error(`Netinkamas DOCUMENTS_INDEX_COMMIT: ${fromEnv}`);
        }
        return fromEnv;
    }
    return "auto";
}

/*
Porcijos „build" etapo skaidymas. Drainer'is parodo, kad laikas praeina
`buildDoc`, bet ne tai, ar jį suvalgo sidecar'ų skaitymas iš disko, ar teksto
sulietuvinimas procesoriuje — o tai skirtingi sprendimai (I/O lygiagretumas
prieš tekstų dydį).

Skaitiklis kuriamas kiekvienam kvietimui atskirai, o ne modulio lygyje:
`runShardedDrain` visus shard'us suka viename procese, tad bendras objektas
maišytų jų skaičius.

Sidecar'ai skaitomi partijomis, tad trukmes sudėti teisinga — partijos eina
nuosekliai. Taip pat ir sulietuvinimas: jis sinchroninis.
*/
const newBuildStats = () => ({
    batches: 0, keys: 0, hits: 0, sidecarMs: 0, foldMs: 0, foldChars: 0, truncated: 0,
});

/*
Indeksuojamo teksto riba.

Dokumentų dydžiai labai nelygūs: vidutinis ~36 tūkst. simbolių, bet 196 iš
8,3 mln. viršija 2 mln., o didžiausias turi 448 mln. Tokia eilutė JS-e užima
~900 MB, o `foldLithuanian` daro normalize("NFD") → replace → normalize("NFC"),
tad vienam dokumentui prireikia kelių GB laikinos native atminties — būtent taip
procesas ir krito su „Zone Allocation failed".

Riba saugo ir siuntimą: `chunkNdjsonLines` skaido tik per eilutes, o vienas
dokumentas yra viena eilutė, tad be ribos ji viršytų ir 4 MiB gabalo dydį, ir
Quickwit `content_length_limit`.

2 mln. simbolių paliečia 196 dokumentus (0,002 %). Pilnas tekstas lieka
sidecar-e, tad ištraukos ir MCP teksto skaitymas nenukenčia — apkarpoma tik tai,
pagal ką ieškoma.
*/
const MAX_INDEXED_TEXT_CHARS = 2_000_000;

/*
Sidecar-ų skaitymo porcijos.

Sidecar-ai suspausti, ir kai kurie išsiplečia dramatiškai: didžiausias dokumentas
diske užima 0,1 MB, o JS eilutėje – 855 MB (448 mln. simbolių, labai
pasikartojantis tekstas). Skaitant vienu kartu visus 500 raktų, SQLite
darbininkas išskleidžia juos VISUS prieš atiduodamas, o `postMessage` dar
nukopijuoja – kelios tokios eilutės vienoje porcijoje ir procesas krinta su
„Zone Allocation failed", nes ZFS ARC laiko 30,7 GB ir tikrai laisvos lieka
vos ~4 GB.

Todėl skaitom dviem srautais: įprastus dokumentus – po SIDECAR_CHUNK raktų,
o didelius (žinom iš characterCount) – po vieną, kad vienu metu atmintyje
išsiplėstų daugiausia vienas.
*/
const SIDECAR_CHUNK = 100;

/** Įrašo/atnaujina indekso schemą `quickwit.lenteles`, kaip daro juridiniai. */
export async function ensureDocumentsQuickwitConfig() {
    if (configRegistered) return;
    await postgres.query(
        `INSERT INTO "quickwit"."lenteles" AS l
            ("lentele", "defaultShardSize", "indexConfig")
         VALUES ($1, $2, $3)
         ON CONFLICT ("lentele") DO UPDATE SET
            "defaultShardSize" = EXCLUDED."defaultShardSize",
            "indexConfig" = EXCLUDED."indexConfig"
         WHERE ROW(
            l."defaultShardSize",
            l."indexConfig"
         ) IS DISTINCT FROM ROW(
            EXCLUDED."defaultShardSize",
            EXCLUDED."indexConfig"
         )`,
        [LENTELE, 1_000_000, DOCUMENTS_QUICKWIT_INDEX_CONFIG],
    );
    configRegistered = true;
}

/**
 * Nusausina vieną `documents."indexQueue"` porciją į Quickwit.
 * Karkasas (tranzakcija, dedup, shard'inimas) — `quickwit/indexQueueDrainer.js`.
 *
 * @param {{ shard?: number, shardCount?: number }} [opts]
 * @returns {Promise<boolean>} `true`, jei buvo apdorota eilučių.
 */
export async function processDocumentsIndexQueue(opts = {}) {
    await ensureDocumentsQuickwitConfig();
    const commit = opts.commit ?? parseCommitMode();
    const stats = newBuildStats();
    /*
    Porcijos sidecar'ai: md5 → turinys. Užpildo fetchRows, naudoja buildDoc.

    Atlaisvinam iškart, kai sudėliotas paskutinis dokumentas, o ne laikom iki
    kito fetchRows. Kitaip per `indexDocs` vienu metu gyvuotų trys to paties
    teksto kopijos: žalias sidecar'as, sulietuvintas dokumente ir NDJSON eilutė.
    Prie ~18 mln. simbolių porcijai tai apie 35 MB kiekvienam iš 8 shard'ų.

    Skaičiuojam likutį, o ne trinam po kiekvieno panaudojimo: kelios eilutės
    gali dalintis tuo pačiu md5.
    */
    const sidecars = new Map();
    let pendingBuilds = 0;
    const worked = await drainIndexQueue(
        {
            lentele: LENTELE,
            queueTable: "indexQueue",
            queueSchema: "documents",
            keyColumn: "documentId",
            changeColumn: "change",
            batchSize: BATCH_SIZE,
            commit,
            rowId: (row) => row.id,
            // Sidecar'us paimam visai porcijai iš karto (žr. fetchRows), tad
            // čia lieka tik grynas dokumento sudėliojimas.
            buildDoc: (row) => {
                const doc = buildDoc(row, sidecars.get(row.md5) ?? null, stats);
                if (--pendingBuilds <= 0) sidecars.clear();
                return doc;
            },
            fetchRows: async (client, ids) => {
                sidecars.clear();
                pendingBuilds = 0;
                // Skaitom iš vaizdo: jis išsprendžia žodynus ir paveldi
                // laukus iš public.files.
                const { rows } = await client.query(
                    `SELECT
                        id, md5, class, type, parent, "fileId",
                        host, domain, url, source,
                        "institutionJarCode"::text AS "istaigaJar",
                        "sourceId0", "sourceId1", "sourceId2", "sourceId3",
                        author, title,
                        extension, "mimeType", language,
                        "pageCount", "wordCount", "characterCount",
                        CASE WHEN location IS NULL THEN NULL ELSE ST_Y(location::geometry) END AS lat,
                        CASE WHEN location IS NULL THEN NULL ELSE ST_X(location::geometry) END AS lon,
                        "discoveredAt", "createdAt", "updatedAt", "happenedAt"
                     FROM documents."documentsFull"
                     WHERE id = ANY($1::int[])`,
                    [ids],
                );

                // Partijomis vietoj 500 atskirų kreipinių (anksčiau tiek
                // lygiagrečių skaitymų užkimšdavo sidecar-ų mazgą), bet
                // ribotomis – žr. SIDECAR_CHUNK.
                const iprasti = new Set();
                const dideli = new Set();
                for (const row of rows) {
                    if (!row.md5) continue;
                    const target = row.characterCount > MAX_INDEXED_TEXT_CHARS ? dideli : iprasti;
                    target.add(row.md5);
                }

                const started = performance.now();
                const iprastuSarasas = [...iprasti];
                for (let i = 0; i < iprastuSarasas.length; i += SIDECAR_CHUNK) {
                    const chunk = iprastuSarasas.slice(i, i + SIDECAR_CHUNK);
                    const found = await readDocumentsFs(chunk);
                    stats.batches++;
                    stats.keys += chunk.length;
                    stats.hits += found.size;
                    for (const [key, value] of found) sidecars.set(key, value);
                }
                for (const md5 of dideli) {
                    const value = await readDocumentFs(md5);
                    stats.batches++;
                    stats.keys++;
                    if (value) {
                        stats.hits++;
                        sidecars.set(md5, value);
                    }
                }
                stats.sidecarMs += performance.now() - started;
                pendingBuilds = rows.length;
                return rows;
            },
            logger,
        },
        opts,
    );

    if (worked && stats.keys) {
        const trukstami = stats.keys - stats.hits;
        logger.log(
            `${LENTELE}${zyme(opts)}: sidecar ${Math.round(stats.sidecarMs)}ms / ` +
            `${stats.keys} raktų ${stats.batches} partija (-omis)` +
            `${trukstami ? `, nerasta ${trukstami}` : ""} | ` +
            `sulietuvinta ${Math.round(stats.foldMs)}ms / ` +
            `${(stats.foldChars / 1_000_000).toFixed(1)}M simbolių` +
            `${stats.truncated ? `, apkarpyta ${stats.truncated}` : ""}`,
        );
    }
    return worked;
}

/** Kurio shard'o eilutė, kad logas sutaptų su drainer'io žymėjimu. */
const zyme = ({ shard, shardCount } = {}) =>
    shardCount > 1 ? `[${shard}/${shardCount}]` : "";

/*
Metaduomenys be teksto dublikato.

Teksto ekstrakcija į sidecar-ą deda ir `metadata.text` – pilną žalio teksto
kopiją. Patikrinta: taip yra 8 iš 10 archive/txt dokumentų. Viršutinio lygio
`text` rašant apkarpomas, o `metadata.text` – ne, tad būtent jis išpūtė
didžiausią sidecar-ą iki 177 MB (dok. 3331029, geodezijos taškų CSV).

Į indeksą jis nereikalingas jokiu atveju: tas pats tekstas jau eina `text`
lauke, o fasetėms naudojami tik smulkūs metadata raktai (teismas, rusis,
galiojimas ir pan.). Išmetus, dokumentai sumažėja maždaug perpus.

Tikroji vieta taisyti – ekstrakcija, kuri to dublikato apskritai neturėtų
saugoti; čia tik apsisaugom indeksuodami.
*/
function metadataBeTeksto(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata ?? null;
    if (!("text" in metadata)) return metadata;
    const { text: _duplikatas, ...likusi } = metadata;
    return likusi;
}

/** Sulietuvina dokumento tekstą ir suskaičiuoja, kiek tai kainavo. */
function foldText(text, stats) {
    if (!text) return null;
    // Apkerpam PRIEŠ normalizavimą – kitaip kaina jau būtų sumokėta.
    const capped = text.length > MAX_INDEXED_TEXT_CHARS
        ? text.slice(0, MAX_INDEXED_TEXT_CHARS)
        : text;
    if (capped.length < text.length) stats.truncated++;
    const started = performance.now();
    const folded = foldLithuanian(capped);
    stats.foldMs += performance.now() - started;
    stats.foldChars += capped.length;
    return folded;
}

function buildDoc(row, sidecar, stats) {
    // DB eilutė turi filtruojamus laukus, sidecar — didelius / masyvinius /
    // laisvos formos. Sidecar laimi, kai reikšmę turi abu (jis yra tiesos
    // šaltinis), DB eilutė užpildo, kai sidecar'o nėra arba jis nepilnas.
    const s = sidecar || {};
    const author = s.author ?? row.author ?? null;
    const title = s.title ?? row.title ?? null;
    return {
        id: row.id,
        md5: row.md5,
        class: row.class,
        type: row.type,
        parent: row.parent,
        fileId: row.fileId,

        host: row.host,
        domain: row.domain,
        url: row.url,
        source: row.source,
        istaigaJar: row.istaigaJar,

        sourceId0: row.sourceId0,
        sourceId1: row.sourceId1,
        sourceId2: row.sourceId2,
        sourceId3: row.sourceId3,

        jarKodai: s.jarKodai ?? [],
        phones: s.phones ?? [],
        emails: s.emails ?? [],
        iban: s.iban ?? [],
        domains: s.domains ?? [],

        // Originalas rodymui ir tiksliai atitikčiai, sulietuvintas – paieškai.
        author,
        authorAscii: author ? foldLithuanian(author) : null,
        title,
        titleAscii: title ? foldLithuanian(title) : null,

        extension: row.extension,
        mimeType: row.mimeType,
        metadata: metadataBeTeksto(s.metadata),
        language: row.language,
        pageCount: row.pageCount,
        wordCount: row.wordCount,
        characterCount: row.characterCount,

        text: foldText(s.text, stats),

        // DB jų nebeturi (buvo 100 % NULL), bet indekso laukai lieka, kol
        // gyvos atitinkamos paieškos fasetės.
        savivaldybe: null,
        apskritis: null,

        // geo.lat / geo.lon rėmelio filtrui, geo.zN – žemėlapio langeliams.
        geo: buildGeo(row.lat, row.lon),

        discoveredAt: toRfc3339(row.discoveredAt),
        createdAt: toRfc3339(row.createdAt),
        // Quickwit reikalauja, kad timestamp_field (updatedAt) nebūtų null.
        // Nežinomam atvejui imam „dabar" — indeksavimo laikas yra tinkamas pakaitalas.
        updatedAt: toRfc3339(row.updatedAt) ?? new Date().toISOString(),
        happenedAt: toRfc3339(row.happenedAt),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    logger.log(`${LENTELE}: Quickwit commit režimas – ${parseCommitMode()}`);
    await runShardedDrain({
        work: processDocumentsIndexQueue,
        label: "documents",
        logger,
    });
    await postgres.end();
    process.exit(0);
}
