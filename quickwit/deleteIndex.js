import { pathToFileURL } from "url";
import { postgres } from "../postgres/postgres.js";
import { Logger } from "../utils/log.js";
import { QW_URL } from "./qwHttp.js";
const logger = new Logger();

/**
 * Delete one Quickwit index and its quickwit.indeksai row.
 *
 * @param {string} indeksas
 * @param {{ allowLive?: boolean, protectLatest?: boolean, dryRun?: boolean }} options
 * @returns {Promise<{ deleted: boolean, reason?: string, alreadyAbsent?: boolean, live: number }>}
 */
export async function deleteIndex(
  indeksas,
  { allowLive = false, protectLatest = false, dryRun = false } = {},
) {
  const client = await postgres.connect();

  try {
    await client.query("BEGIN");

    const { rows: indexRows } = await client.query(
      `SELECT "lentele"
       FROM "quickwit"."indeksai"
       WHERE "indeksas" = $1`,
      [indeksas],
    );
    if (!indexRows.length) {
      await client.query("ROLLBACK");
      return { deleted: false, reason: "indeksas nerastas DB", live: 0 };
    }

    const lentele = indexRows[0].lentele;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [lentele]);

    const { rows } = await client.query(
      `SELECT COUNT(e.*)::int AS "live",
              i."seq" = latest."seq" AS "latest"
       FROM "quickwit"."indeksai" i
       CROSS JOIN LATERAL (
         SELECT MAX("seq") AS "seq"
         FROM "quickwit"."indeksai"
         WHERE "lentele" = i."lentele"
       ) latest
       LEFT JOIN "quickwit"."eilutes" e
         ON e."indeksaiId" = i.id
       WHERE i."lentele" = $1 AND i."indeksas" = $2
       GROUP BY i."lentele", i."seq", latest."seq"`,
      [lentele, indeksas],
    );
    const live = rows[0]?.live ?? 0;

    if (protectLatest && rows[0]?.latest) {
      await client.query("ROLLBACK");
      return { deleted: false, reason: "paskutinis lentelės indeksas", live };
    }
    if (!allowLive && live > 0) {
      await client.query("ROLLBACK");
      return { deleted: false, reason: `${live} faktinių gyvų eilučių`, live };
    }
    if (dryRun) {
      await client.query("ROLLBACK");
      return { deleted: false, reason: "dry-run", live };
    }

    const response = await fetch(`${QW_URL}/api/v1/indexes/${encodeURIComponent(indeksas)}`, {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Quickwit DELETE returned ${response.status}: ${await response.text()}`);
    }

    await client.query(`DELETE FROM "quickwit"."indeksai" WHERE "indeksas" = $1`, [indeksas]);
    await client.query("COMMIT");
    return { deleted: true, alreadyAbsent: response.status === 404, live };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const indeksas = args.find((arg) => !arg.startsWith("--"));

  if (!indeksas) {
    console.error("usage: node quickwit/deleteIndex.js <indeksas> [--force] [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const result = await deleteIndex(indeksas, { allowLive: force, dryRun });
  if (result.deleted) {
    logger.log(`Ištrintas ${indeksas}${result.alreadyAbsent ? " (Quickwit jau nebuvo)" : ""}`);
  } else if (dryRun && result.reason === "dry-run") {
    logger.log(`[dry-run] būtų ištrintas ${indeksas}, faktinių gyvų eilučių: ${result.live}`);
  } else {
    console.error(`neištrintas ${indeksas}: ${result.reason}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(`Nepavyko ištrinti Quickwit indekso: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await postgres.end();
    });
}
