import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const BATCH_SIZE = 5000;

// Pass 2 of the failai → dokumentai migration: resolve `parent`.
// For each failai with parent IS NOT NULL, find its dokumentai row and
// the parent failai's dokumentai row, then set dokumentai.parent to that id.
//
// Runs in repeated passes — if a child was migrated before its parent, the
// next pass picks it up once both exist.

async function runPass() {
    let lastFailasId = 0;
    let updated = 0;
    let batchNum = 0;

    while (true) {
        const { rows } = await postgres.query(
            `SELECT id
             FROM public.failai
             WHERE parent IS NOT NULL AND id > $1
             ORDER BY id
             LIMIT $2`,
            [lastFailasId, BATCH_SIZE],
        );

        if (rows.length === 0) break;

        const ids = rows.map((r) => r.id);
        lastFailasId = rows[rows.length - 1].id;

        const upd = await postgres.query(
            `WITH src AS (
                SELECT d.id AS doc_id, p.id AS parent_doc_id
                FROM public.failai f
                JOIN public.dokumentai d
                    ON d."failasId" = f.id AND d.parent IS NULL
                JOIN public.dokumentai p
                    ON p."failasId" = f.parent
                WHERE f.id = ANY($1)
            )
            UPDATE public.dokumentai d
            SET parent = src.parent_doc_id
            FROM src
            WHERE d.id = src.doc_id`,
            [ids],
        );

        updated += upd.rowCount;
        batchNum++;
        log(
            `  batch ${batchNum} | iki failai.id=${lastFailasId} | atnaujinta: ${upd.rowCount} | viso šiame pass: ${updated.toLocaleString()}`,
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
        log(`Pass ${pass} pradedame…`);
        const passUpdated = await runPass();
        totalUpdated += passUpdated;
        log(`Pass ${pass} baigtas. Atnaujinta: ${passUpdated.toLocaleString()}`);
        if (passUpdated === 0) break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Baigta. Viso atnaujinta tėvų: ${totalUpdated.toLocaleString()} per ${elapsed}s (${pass} pass)`);

    // Diagnostic: how many remain unresolved?
    const {
        rows: [{ count }],
    } = await postgres.query(
        `SELECT COUNT(*)::int AS count
         FROM public.failai f
         JOIN public.dokumentai d ON d."failasId" = f.id
         WHERE f.parent IS NOT NULL AND d.parent IS NULL`,
    );
    if (count > 0) {
        log(`Pastaba: ${count.toLocaleString()} dokumentų liko be parent — tėvų failai dar nemigruoti į dokumentai.`);
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
