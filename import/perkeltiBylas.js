import { mysql } from "../mysql/mysql.js";
import { postgres } from "../postgres/postgres.js";

const BATCH_SIZE = 100;

async function migrateBylos() {
    let lastId = 0;
    let migrated = 0;

    try {
        while (true) {
            const [rows] = await mysql.execute(
                `SELECT * FROM bylos WHERE id > ? ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
                [lastId],
            );

            if (rows.length === 0) break;

            // Build placeholders for batch insert
            const placeholders = rows
                .map(
                    (_, i) =>
                        `($${i * 12 + 1}, $${i * 12 + 2}, $${i * 12 + 3}, $${i * 12 + 4}, $${i * 12 + 5}, $${i * 12 + 6}, $${i * 12 + 7}, $${i * 12 + 8}, $${i * 12 + 9}, $${i * 12 + 10}, $${i * 12 + 11}, $${i * 12 + 12})`,
                )
                .join(", ");

            // Flatten values
            const values = rows.flatMap((r) => [
                r.id,
                r.bylosNumeris,
                r.bylosRusis,
                r.data,
                r.teisejai,
                r.salys || null,
                r.citavimasKitoseBylose || null,
                r.teismas,
                r.teismoRumai || null,
                r.fileText,
                r.fileHref,
                r.juridiniuNuskaitymas || null,
            ]);

            try {
                await postgres.query(
                    `INSERT INTO "bylos" (
                            id, "bylosNumeris", "bylosRusis", data, teisejai, salys, "citavimasKitoseBylose",
                            teismas, "teismoRumai", "fileText", "fileHref", "juridiniuNuskaitymas"
                        ) VALUES ${placeholders}
                        ON CONFLICT (id) DO NOTHING`,
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

            console.log(`Migrated ${migrated} rows so far...`);
        }

        console.log(`Migration completed. Total rows migrated: ${migrated}`);
    } catch (err) {
        console.error("Migration error:", err.message);
    } finally {
        await mysql.end();
        await postgres.end();
    }
}

migrateBylos();
