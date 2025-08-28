import { mysql } from "../mysql/mysql.js";
import { postgres } from "../postgres/postgres.js";

const BATCH_SIZE = 100;

async function migrateBylosDalyviaiBatch() {
    let lastId = 0;
    let migrated = 0;

    try {
        while (true) {
            const [rows] = await mysql.execute(
                `SELECT * FROM bylosDalyviai WHERE id > ? ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
                [lastId],
            );

            if (rows.length === 0) break;

            // Build placeholders for batch insert
            const placeholders = rows
                .map(
                    (_, i) =>
                        `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`,
                )
                .join(", ");

            // Flatten values
            const values = rows.flatMap((r) => [
                r.id,
                r.bylosId,
                r.pavadinimas,
                r.kodas,
                r.bylojeKaip,
            ]);

            try {
                await postgres.query(
                    `INSERT INTO "bylosDalyviai" ("id", "bylosId", "pavadinimas", "kodas", "bylojeKaip")
                     VALUES ${placeholders}
                     ON CONFLICT ("id") DO NOTHING`,
                    values,
                );

                migrated += rows.length;
                lastId = rows[rows.length - 1].id;

                console.log(`Migrated ${migrated} rows so far...`);
            } catch (err) {
                console.error(
                    `Failed to migrate batch ending with id ${lastId}:`,
                    err.message,
                );
            }
        }

        console.log(`Migration completed. Total rows migrated: ${migrated}`);
    } catch (err) {
        console.error("Migration error:", err.message);
    } finally {
        await mysql.end();
        await postgres.end();
    }
}

migrateBylosDalyviaiBatch();
