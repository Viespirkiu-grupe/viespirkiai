import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { readMetaduomenysFs } from "./metaduomenysFs.js";
import { readTekstasFs } from "./tekstasFs.js";
import { getFailaiPath, hashFailai, saveFailaiFs } from "./failaiFs.js";

const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 1_000;
const FS_CONCURRENCY = Number(process.env.FS_CONCURRENCY) || 64;

// Grupuoja subjektų eilutes pagal failo id į Map<id, mappedRow[]>.
function groupBy(rows, map) {
    const grouped = new Map();
    for (const row of rows) {
        let arr = grouped.get(row.id);
        if (!arr) {
            arr = [];
            grouped.set(row.id, arr);
        }
        arr.push(map(row));
    }
    return grouped;
}

// Naudojam id RUOŽO scan (id BETWEEN min AND max), ne id = ANY(1000 taškų).
// Batch'o eilutės surūšiuotos pagal id, tad ruožas efektyviai naudoja (id, ...)
// composite indeksus vietoj 1000 atskirų probe'ų. ORDER BY nereikia — tvarka
// JSON'e nesvarbi (skaitymo kelias rūšiuoja rodydamas). Ruožas gali paimti
// šiek tiek papildomų id (kurių nėra šiame batch'e) — jie tiesiog ignoruojami.
async function fetchEntities(minId, maxId) {
    const range = [minId, maxId];
    const [iban, jarKodai, links, emails, domains, telefonai] = await Promise.all([
        postgres.query(
            `SELECT id, iban, puslapiai FROM "failaiIban" WHERE id >= $1 AND id <= $2`,
            range,
        ),
        postgres.query(
            `SELECT id, "jarKodas", puslapiai FROM "failaiJarKodai" WHERE id >= $1 AND id <= $2`,
            range,
        ),
        postgres.query(
            `SELECT id, link, puslapiai FROM "failaiLinks" WHERE id >= $1 AND id <= $2`,
            range,
        ),
        postgres.query(
            `SELECT id, email, puslapiai FROM "failaiEmails" WHERE id >= $1 AND id <= $2`,
            range,
        ),
        postgres.query(
            `SELECT id, domain FROM "failaiDomains" WHERE id >= $1 AND id <= $2`,
            range,
        ),
        postgres.query(
            `SELECT id, telefonas, puslapiai FROM "failaiTelefonai" WHERE id >= $1 AND id <= $2`,
            range,
        ),
    ]);

    return {
        iban: groupBy(iban.rows, (r) => ({ iban: r.iban, puslapiai: r.puslapiai })),
        jarKodai: groupBy(jarKodai.rows, (r) => ({ jarKodas: r.jarKodas, puslapiai: r.puslapiai })),
        links: groupBy(links.rows, (r) => ({ link: r.link, puslapiai: r.puslapiai })),
        emails: groupBy(emails.rows, (r) => ({ email: r.email, puslapiai: r.puslapiai })),
        domains: groupBy(domains.rows, (r) => r.domain),
        telefonai: groupBy(telefonai.rows, (r) => ({ telefonas: r.telefonas, puslapiai: r.puslapiai })),
    };
}

async function processBatch(rows) {
    // Laiko išskaidymas — agreguoti ms per visas gijas (persidengia, tad rodo
    // santykinį svorį, ne wall-time). readMax/writeMax — lėčiausia atskira operacija.
    const t = { entities: 0, read: 0, hash: 0, write: 0, upsert: 0, readMax: 0, writeMax: 0 };
    let readCount = 0;
    let readNull = 0;

    let ts = performance.now();
    // rows surūšiuotos pagal id didėjančiai → ruožas = [pirmas, paskutinis].
    const entities = await fetchEntities(rows[0].id, rows[rows.length - 1].id);
    t.entities = performance.now() - ts;

    const updates = []; // [{ id, hash }]
    let written = 0;
    let skipped = 0;

    let cursor = 0;
    async function worker() {
        while (cursor < rows.length) {
            const row = rows[cursor++];

            const rs = performance.now();
            const [metaduomenys, tekstas] = await Promise.all([
                row.metaduomenysHash ? readMetaduomenysFs(row.metaduomenysHash) : Promise.resolve(null),
                row.tekstasHash ? readTekstasFs(row.tekstasHash) : Promise.resolve(null),
            ]);
            const rd = performance.now() - rs;
            t.read += rd;
            if (rd > t.readMax) t.readMax = rd;
            readCount++;
            if ((row.metaduomenysHash && metaduomenys == null) || (row.tekstasHash && tekstas == null)) readNull++;

            const iban = entities.iban.get(row.id) ?? [];
            const jarKodai = entities.jarKodai.get(row.id) ?? [];
            const links = entities.links.get(row.id) ?? [];
            const emails = entities.emails.get(row.id) ?? [];
            const domains = entities.domains.get(row.id) ?? [];
            const telefonai = entities.telefonai.get(row.id) ?? [];

            // Nėra jokio turinio — nėra ką backfillinti.
            if (
                metaduomenys == null && tekstas == null &&
                !iban.length && !jarKodai.length && !links.length &&
                !emails.length && !domains.length && !telefonai.length
            ) {
                skipped++;
                continue;
            }

            const turinys = {
                tekstas,
                metaduomenys,
                iban,
                jarKodai,
                links,
                emails,
                domains,
                telefonai,
            };
            const hs = performance.now();
            const hash = hashFailai(turinys);
            t.hash += performance.now() - hs;

            const filePath = getFailaiPath(hash);
            if (!filePath) {
                throw new Error("failaiLocation nenustatytas arba yra nuotolinis URL");
            }
            // Rašom visada (idempotentiška: tas pats turinys → tas pats failas).
            // Vengiam papildomo fileExists stat'o — brangaus IOP'o šiam raidz pool'ui.
            const ws = performance.now();
            await saveFailaiFs(hash, turinys);
            const wd = performance.now() - ws;
            t.write += wd;
            if (wd > t.writeMax) t.writeMax = wd;
            written++;
            updates.push({ id: row.id, hash });
        }
    }

    const workers = Array.from({ length: Math.min(FS_CONCURRENCY, rows.length) }, worker);
    await Promise.all(workers);

    if (updates.length > 0) {
        const upIds = updates.map((u) => u.id);
        const hashes = updates.map((u) => u.hash);
        ts = performance.now();
        // Rašoma į atskirą žemėlapio lentelę — failai NEliečiama (jokių trigerių).
        await postgres.query(
            `INSERT INTO public."failaiInfoFailai" (id, "failasHash")
             SELECT UNNEST($1::bigint[]), UNNEST($2::text[])
             ON CONFLICT (id) DO UPDATE SET "failasHash" = EXCLUDED."failasHash"`,
            [upIds, hashes],
        );
        t.upsert = performance.now() - ts;
    }

    return { written, skipped, updated: updates.length, t, readCount, readNull };
}

async function run() {
    const startTime = Date.now();
    let lastId = 0;
    let batchNum = 0;
    let totalSeen = 0;
    let totalWritten = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    while (true) {
        const batchStart = Date.now();
        // Tik dar nesutvarkytos eilutės (be įrašo failaiInfoFailai), turinčios seną turinį.
        const selStart = performance.now();
        const { rows } = await postgres.query(
            `SELECT f.id, f."metaduomenysHash", f."tekstasHash"
             FROM public.failai f
             LEFT JOIN public."failaiInfoFailai" i ON i.id = f.id
             WHERE f.id > $1
               AND i.id IS NULL
               AND (f."metaduomenysHash" IS NOT NULL OR f."tekstasHash" IS NOT NULL)
             ORDER BY f.id
             LIMIT $2`,
            [lastId, BATCH_SIZE],
        );
        const selectMs = performance.now() - selStart;

        if (rows.length === 0) break;

        const { written, skipped, updated, t, readCount, readNull } = await processBatch(rows);

        lastId = rows[rows.length - 1].id;
        batchNum++;
        totalSeen += rows.length;
        totalWritten += written;
        totalUpdated += updated;
        totalSkipped += skipped;

        const batchMs = Date.now() - batchStart;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(totalSeen / elapsed);
        const ms = (x) => Math.round(x);
        // t.read/t.write — agreguota per gijas (persidengia). read/write avg — vidutinė
        // vienos operacijos trukmė (aiškiausias rodiklis). max — lėčiausia atskira op.
        const readAvg = readCount ? (t.read / readCount).toFixed(1) : "0";
        const writeAvg = written ? (t.write / written).toFixed(1) : "0";
        logger.log(
            `Batch ${batchNum} | iki id=${lastId} | rašyta: ${written} | atnaujinta: ${updated} | praleista: ${skipped} | viso: ${totalSeen.toLocaleString()} | greitis: ${speed.toLocaleString()} eil/s | batch: ${batchMs}ms` +
            ` || select: ${ms(selectMs)}ms | entities: ${ms(t.entities)}ms | upsert: ${ms(t.upsert)}ms` +
            ` | read Σ${ms(t.read)}ms avg${readAvg} max${ms(t.readMax)} (null:${readNull})` +
            ` | write Σ${ms(t.write)}ms avg${writeAvg} max${ms(t.writeMax)} | hash Σ${ms(t.hash)}ms`,
        );

        if (rows.length < BATCH_SIZE) break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(
        `Baigta. Peržiūrėta: ${totalSeen.toLocaleString()} | rašyta į FS: ${totalWritten.toLocaleString()} | atnaujinta DB: ${totalUpdated.toLocaleString()} | praleista: ${totalSkipped.toLocaleString()} per ${elapsed}s`,
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run()
        .then(async () => {
            await postgres.end();
            process.exit(0);
        })
        .catch(async (err) => {
            console.error("Klaida:", err);
            await postgres.end();
            process.exit(1);
        });
}
