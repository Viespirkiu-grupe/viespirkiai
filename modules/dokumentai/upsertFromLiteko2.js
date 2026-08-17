/*
Įkelia LITEKO2 sprendimą į bendrą dokumentų paiešką. LITEKO2 turinio sidecar'as
jau turi dokumentai indeksui tinkamą formą, todėl čia lieka dvi operacijos:
sidecar'o kopija į dokumentų saugyklą ir public.dokumentai eilutės upsert'as.
*/

import { postgres } from "../../postgres/postgres.js";
import { saveDokumentasFs } from "./dokumentaiFs.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

const SOURCE = "liteko2";

/**
 * @param {object} sprendimas - liteko2Sprendimai eilutė.
 * @param {object} sidecar - sudarytiSidecar() rezultatas.
 * @param {object} [db]
 */
export async function upsertLiteko2ToDokumentai(sprendimas, sidecar, db = postgres) {
    if (!sprendimas?.md5 || !sprendimas?.liteko2Id) {
        throw new Error("upsertLiteko2ToDokumentai: trūksta md5 arba liteko2Id");
    }
    if (!sidecar || sidecar.md5 !== sprendimas.md5) {
        throw new Error("upsertLiteko2ToDokumentai: sidecar md5 nesutampa");
    }

    await saveDokumentasFs(sprendimas.md5, sidecar);

    const url = `https://liteko-api-pub.teismas.lt/v1/decisions/${encodeURIComponent(sprendimas.liteko2Id)}`;
    await db.query(
        `INSERT INTO public.dokumentai (
            md5, class, type, source, url,
            "saltinioId0", "saltinioId1", "saltinioId2",
            pavadinimas, extension, "mimeType", language,
            "wordCount", "characterCount", "happenedAt"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (md5) WHERE source = 'liteko2' DO UPDATE SET
            class            = EXCLUDED.class,
            type             = EXCLUDED.type,
            source           = EXCLUDED.source,
            url              = EXCLUDED.url,
            "saltinioId0"    = EXCLUDED."saltinioId0",
            "saltinioId1"    = EXCLUDED."saltinioId1",
            "saltinioId2"    = EXCLUDED."saltinioId2",
            pavadinimas      = EXCLUDED.pavadinimas,
            extension        = EXCLUDED.extension,
            "mimeType"       = EXCLUDED."mimeType",
            language         = EXCLUDED.language,
            "wordCount"      = EXCLUDED."wordCount",
            "characterCount" = EXCLUDED."characterCount",
            "happenedAt"     = EXCLUDED."happenedAt"`,
        [
            sprendimas.md5,
            sidecar.class,
            sidecar.type,
            SOURCE,
            url,
            sidecar.saltinioId0 ?? null,
            sidecar.saltinioId1 ?? null,
            sprendimas.liteko2Id,
            sidecar.title ?? null,
            sidecar.extension ?? null,
            sidecar.extension === "html" ? "text/html" : null,
            "lt",
            sidecar.wordCount ?? null,
            sidecar.characterCount ?? null,
            sidecar.metadata?.sprendimoData ?? sprendimas.sprendimoData ?? null,
        ],
    );
    if (db === postgres) {
        signalWork(WORK_SIGNALS.DOCUMENTS_INDEX_READY, {
            source: "liteko2",
            count: 1,
        });
    }
}
