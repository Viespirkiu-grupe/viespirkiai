import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { readMetaduomenysFs } from "./metaduomenysFs.js";
import { readTekstasFs } from "./tekstasFs.js";
import { getFailaiPath, hashFailai, saveFailaiFs } from "./failaiFs.js";
import fs from "fs";

const BATCH_SIZE = 1_000;
const FS_CONCURRENCY = 32;

async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

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

async function fetchEntities(ids) {
    const [iban, jarKodai, links, emails, domains, telefonai] = await Promise.all([
        postgres.query(
            `SELECT id, iban, puslapiai FROM "failaiIban"
             WHERE id = ANY($1) ORDER BY id, COALESCE(puslapiai[1], 9999), iban ASC`,
            [ids],
        ),
        postgres.query(
            `SELECT id, "jarKodas", puslapiai FROM "failaiJarKodai"
             WHERE id = ANY($1) ORDER BY id, COALESCE(puslapiai[1], 9999), "jarKodas" ASC`,
            [ids],
        ),
        postgres.query(
            `SELECT id, link, puslapiai FROM "failaiLinks"
             WHERE id = ANY($1) ORDER BY id, COALESCE(puslapiai[1], 9999), link ASC`,
            [ids],
        ),
        postgres.query(
            `SELECT id, email, puslapiai FROM "failaiEmails"
             WHERE id = ANY($1) ORDER BY id, COALESCE(puslapiai[1], 9999), email ASC`,
            [ids],
        ),
        postgres.query(
            `SELECT id, domain FROM "failaiDomains"
             WHERE id = ANY($1) ORDER BY id, domain ASC`,
            [ids],
        ),
        postgres.query(
            `SELECT id, telefonas, puslapiai FROM "failaiTelefonai"
             WHERE id = ANY($1) ORDER BY id, COALESCE(puslapiai[1], 9999), telefonas ASC`,
            [ids],
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
    const ids = rows.map((r) => r.id);
    const entities = await fetchEntities(ids);

    const updates = []; // [{ id, hash }]
    let written = 0;
    let skipped = 0;

    let cursor = 0;
    async function worker() {
        while (cursor < rows.length) {
            const row = rows[cursor++];

            const [metaduomenys, tekstas] = await Promise.all([
                row.metaduomenysHash ? readMetaduomenysFs(row.metaduomenysHash) : Promise.resolve(null),
                row.tekstasHash ? readTekstasFs(row.tekstasHash) : Promise.resolve(null),
            ]);

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
            const hash = hashFailai(turinys);
            const filePath = getFailaiPath(hash);
            if (!filePath) {
                throw new Error("failaiLocation nenustatytas arba yra nuotolinis URL");
            }
            if (!(await fileExists(filePath))) {
                await saveFailaiFs(hash, turinys);
                written++;
            }
            updates.push({ id: row.id, hash });
        }
    }

    const workers = Array.from({ length: Math.min(FS_CONCURRENCY, rows.length) }, worker);
    await Promise.all(workers);

    if (updates.length > 0) {
        const upIds = updates.map((u) => u.id);
        const hashes = updates.map((u) => u.hash);
        // Rašoma į atskirą žemėlapio lentelę — failai NEliečiama (jokių trigerių).
        await postgres.query(
            `INSERT INTO public."failaiInfoFailai" (id, "failasHash")
             SELECT UNNEST($1::bigint[]), UNNEST($2::text[])
             ON CONFLICT (id) DO UPDATE SET "failasHash" = EXCLUDED."failasHash"`,
            [upIds, hashes],
        );
    }

    return { written, skipped, updated: updates.length };
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

        if (rows.length === 0) break;

        const { written, skipped, updated } = await processBatch(rows);

        lastId = rows[rows.length - 1].id;
        batchNum++;
        totalSeen += rows.length;
        totalWritten += written;
        totalUpdated += updated;
        totalSkipped += skipped;

        const batchMs = Date.now() - batchStart;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(totalSeen / elapsed);
        logger.log(
            `Batch ${batchNum} | iki id=${lastId} | rašyta: ${written} | atnaujinta: ${updated} | praleista: ${skipped} | viso: ${totalSeen.toLocaleString()} | greitis: ${speed.toLocaleString()} eil/s | batch: ${batchMs}ms`,
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
