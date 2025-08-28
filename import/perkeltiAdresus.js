import { mysql } from "../mysql/mysql.js";
import { postgres } from "../postgres/postgres.js";

const BATCH_SIZE = 100;

async function migrateAdresai() {
    let lastId = 0;
    let migrated = 0;

    try {
        while (true) {
            // Fetch batch of addresses from MySQL
            const [rows] = await mysql.execute(
                `SELECT * FROM adresai WHERE id > ? ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
                [lastId],
            );

            if (rows.length === 0) break;

            for (const r of rows) {
                try {
                    await postgres.query(
                        `INSERT INTO adresai (
                          id, latitude, longitude, adresas
                      ) VALUES ($1,$2,$3,$4)
                      ON CONFLICT (id)
                      DO UPDATE SET
                          latitude = EXCLUDED.latitude,
                          longitude = EXCLUDED.longitude,
                          adresas = EXCLUDED.adresas`,
                        [
                            r.id,
                            parseFloat(r.taskas.y) || 0,
                            parseFloat(r.taskas.x) || 0,
                            r.adresas,
                        ],
                    );

                    migrated++;
                    lastId = r.id;
                } catch (err) {
                    console.error(`Failed to migrate id ${r.id}:`, err.message);
                }
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

migrateAdresai();
