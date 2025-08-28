import { mysql } from "../mysql/mysql.js";
import { postgres } from "../postgres/postgres.js";

async function migrateFailaiBatch(batchSize = 100) {
    try {
        while (true) {
            const [rows] = await mysql.execute(
                `SELECT * FROM failai
         WHERE perkeltasPostgres IS NULL OR perkeltasPostgres = 0
         LIMIT ${batchSize}`,
            );

            if (rows.length === 0) {
                console.log("All rows migrated.");
                break;
            }

            const values = [];
            const placeholders = rows
                .map((row, idx) => {
                    const base = idx * 10;
                    values.push(
                        row.id,
                        row.dokId,
                        row.fileId,
                        row.pavadinimas,
                        row.extension || null,
                        row.dydis || null,
                        row.md5 || null,
                        row.saugojama || null,
                        row.parsiustas,
                        row.nuskaitytas || null,
                    );
                    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`;
                })
                .join(", ");

            try {
                await postgres.query(
                    `INSERT INTO failai (
            id, "dokId", "fileId", pavadinimas, extension, dydis, md5, saugojama, parsiustas, nuskaitytas
          ) VALUES ${placeholders}
          ON CONFLICT (id) DO NOTHING`,
                    values,
                );

                // Mark all rows in MySQL as migrated
                const ids = rows.map((r) => r.id);
                await mysql.execute(
                    `UPDATE failai SET perkeltasPostgres = 1 WHERE id IN (${ids.map(() => "?").join(",")})`,
                    ids,
                );

                console.log(`Migrated ids: ${ids.join(", ")}`);
            } catch (err) {
                console.error("Failed to migrate batch:", err.message);
            }
        }
    } catch (err) {
        console.error("Migration error:", err.message);
    } finally {
        await mysql.end();
        await postgres.end();
    }
}

migrateFailaiBatch();
