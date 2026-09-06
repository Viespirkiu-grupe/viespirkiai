import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

const BATCH_SIZE = 5000;

// Pass 2 of the files → documents migration: resolve `parent` ir paveldi
// `istaigaJar`.
//
// 1) Kiekvienam failai su parent IS NOT NULL randam jo documents eilutę ir
//    tėvo failo documents eilutę, tada nustatom documents.parent.
// 2) Archive (child) failai šaltinio JOIN'ų neatitinka (žr. upsertFromFailai.js),
//    todėl jų istaigaJar lieka NULL — čia jį paveldim iš tėvo dokumento.
//
// Abu žingsniai sukasi kartotiniais passais — jei vaikas migruotas anksčiau už
// tėvą (arba įdėtiniai archyvai), kitas passas pasiima, kai abu jau egzistuoja.
// istaigaJar paveldėjimas NEsiriša su parent išsprendimu (atskira sąlyga
// d."institutionJarCode" IS NULL), kad įdėtinių archyvų lygiai užsipildytų po vieną.

async function runPass() {
    let lastFailasId = 0;
    let updated = 0;
    let batchNum = 0;

    while (true) {
        const { rows } = await postgres.query(
            `SELECT id
             FROM files.files
             WHERE parent IS NOT NULL AND id > $1
             ORDER BY id
             LIMIT $2`,
            [lastFailasId, BATCH_SIZE],
        );

        if (rows.length === 0) break;

        const ids = rows.map((r) => r.id);
        lastFailasId = rows[rows.length - 1].id;

        const updParent = await postgres.query(
            `WITH src AS (
                SELECT d.id AS doc_id, p.id AS parent_doc_id
                FROM files.files f
                JOIN documents.documents d
                    ON d."fileId" = f.id AND d.parent IS NULL
                JOIN documents.documents p
                    ON p."fileId" = f.parent
                WHERE f.id = ANY($1)
            )
            UPDATE documents.documents d
            SET parent = src.parent_doc_id
            FROM src
            WHERE d.id = src.doc_id`,
            [ids],
        );

        const updJar = await postgres.query(
            `WITH src AS (
                SELECT d.id AS doc_id, p."institutionJarCode" AS parent_jar
                FROM files.files f
                JOIN documents.documents d
                    ON d."fileId" = f.id AND d."institutionJarCode" IS NULL
                JOIN documents.documents p
                    ON p."fileId" = f.parent AND p."institutionJarCode" IS NOT NULL
                WHERE f.id = ANY($1)
            )
            UPDATE documents.documents d
            SET "institutionJarCode" = src.parent_jar
            FROM src
            WHERE d.id = src.doc_id`,
            [ids],
        );

        const batchUpdated = updParent.rowCount + updJar.rowCount;
        updated += batchUpdated;
        batchNum++;
        logger.log(
            `  batch ${batchNum} | iki files.id=${lastFailasId} | parent: ${updParent.rowCount} | institutionJarCode: ${updJar.rowCount} | viso šiame pass: ${updated.toLocaleString()}`,
        );
    }

    return updated;
}

async function run() {
    const startTime = Date.now();
    let pass = 0;
    let totalUpdated = 0;

    while (true) {
        pass++;
        logger.log(`Pass ${pass} pradedame…`);
        const passUpdated = await runPass();
        totalUpdated += passUpdated;
        logger.log(`Pass ${pass} baigtas. Atnaujinta: ${passUpdated.toLocaleString()}`);
        if (passUpdated === 0) break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(`Baigta. Viso atnaujinta tėvų: ${totalUpdated.toLocaleString()} per ${elapsed}s (${pass} pass)`);

    // Diagnostic: how many remain unresolved?
    const {
        rows: [{ count }],
    } = await postgres.query(
        `SELECT COUNT(*)::int AS count
         FROM files.files f
         JOIN documents.documents d ON d."fileId" = f.id
         WHERE f.parent IS NOT NULL AND d.parent IS NULL`,
    );
    if (count > 0) {
        logger.log(`Pastaba: ${count.toLocaleString()} dokumentų liko be parent — tėvų failai dar nemigruoti į documents.`);
    }

    // Diagnostic: child documents, kurių institutionJarCode liko NULL nors tėvas jį turi.
    const {
        rows: [{ count: jarCount }],
    } = await postgres.query(
        `SELECT COUNT(*)::int AS count
         FROM files.files f
         JOIN documents.documents d ON d."fileId" = f.id AND d."institutionJarCode" IS NULL
         JOIN documents.documents p ON p."fileId" = f.parent AND p."institutionJarCode" IS NOT NULL
         WHERE f.parent IS NOT NULL`,
    );
    if (jarCount > 0) {
        logger.log(`Pastaba: ${jarCount.toLocaleString()} child dokumentų liko be istaigaJar nors tėvas jį turi — paleisti pass pakartotinai.`);
    }
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
