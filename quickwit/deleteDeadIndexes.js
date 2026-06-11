import { pathToFileURL } from "url";
import { postgres } from "../postgres/postgres.js";
import { deleteIndex } from "./deleteIndex.js";

// Cached counters only narrow the candidate set. Actual liveness and latest
// index protection are checked by deleteIndex immediately before deletion.
const FACT_CHECK_MAX_LIVE = 5_000;

async function findCandidates() {
  const { rows } = await postgres.query(
    `SELECT i."indeksas", i."gyvosEilutes", i."mirusiosEilutes"
     FROM "quickwitIndeksai" i
     JOIN (
       SELECT "lentele", MAX("seq") AS "paskutinisSeq"
       FROM "quickwitIndeksai"
       GROUP BY "lentele"
     ) latest USING ("lentele")
     WHERE i."seq" < latest."paskutinisSeq"
       AND i."gyvosEilutes" <= $1
     ORDER BY i."lentele", i."seq"`,
    [FACT_CHECK_MAX_LIVE],
  );
  return rows;
}

export async function deleteDeadIndexes({ dryRun = false } = {}) {
  const candidates = await findCandidates();

  if (!candidates.length) {
    console.log("Nėra tikrintinų ne paskutinių Quickwit indeksų.");
    return { deleted: 0, empty: 0, skipped: 0, failed: 0 };
  }

  let deleted = 0;
  let empty = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const result = await deleteIndex(candidate.indeksas, { protectLatest: true, dryRun });

      if (result.deleted) {
        deleted++;
        console.log(
          `deleted ${candidate.indeksas}${result.alreadyAbsent ? " (Quickwit jau nebuvo)" : ""}`,
        );
      } else if (result.reason === "dry-run") {
        empty++;
        console.log(
          `[dry-run] ${candidate.indeksas}: faktas=0, skaitiklis=${candidate.gyvosEilutes}, mirusios=${candidate.mirusiosEilutes}`,
        );
      } else {
        skipped++;
        console.log(`skip ${candidate.indeksas}: ${result.reason}`);
      }
    } catch (error) {
      failed++;
      console.error(`failed ${candidate.indeksas}: ${error.message}`);
    }
  }

  console.log(
    dryRun
      ? `Baigta [dry-run]: tuščių ${empty}, praleista ${skipped}, klaidų ${failed}.`
      : `Baigta: ištrinta ${deleted}, praleista ${skipped}, klaidų ${failed}.`,
  );
  return { deleted, empty, skipped, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deleteDeadIndexes({ dryRun: process.argv.includes("--dry-run") })
    .then(({ failed }) => {
      if (failed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error("Nepavyko išvalyti Quickwit indeksų:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await postgres.end();
    });
}
