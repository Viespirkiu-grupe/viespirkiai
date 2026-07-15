import { postgres } from "../postgres/postgres.js";

const apply = process.argv.includes("--apply");
const predicate = `"faktineIvykdimoData" IS NOT NULL
    AND "faktineIvykdimoData"::time <> time '00:00:00'`;

try {
    const { rows: [summary] } = await postgres.query(
        `SELECT count(*)::int AS count,
                min("faktineIvykdimoData") AS oldest,
                max("faktineIvykdimoData") AS newest
           FROM sutartys
          WHERE ${predicate}`,
    );
    console.log(summary);

    if (!apply) {
        console.log("Dry run only. Pass --apply to remove the time component.");
    } else {
        const result = await postgres.query(
            `UPDATE sutartys
                SET "faktineIvykdimoData" =
                    "faktineIvykdimoData"::date
              WHERE ${predicate}`,
        );
        console.log(`Updated ${result.rowCount} contracts`);
    }
} finally {
    await postgres.end();
}
