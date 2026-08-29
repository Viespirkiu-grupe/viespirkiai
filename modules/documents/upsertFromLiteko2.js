/*
Įkelia LITEKO2 sprendimą į bendrą dokumentų paiešką. LITEKO2 turinio sidecar'as
jau turi indeksui tinkamą formą, todėl čia lieka dvi operacijos: sidecar'o kopija
į dokumentų saugyklą ir documents.documents eilutės upsert'as.
*/

import { postgres } from "../../postgres/postgres.js";
import { saveDocumentFs } from "./documentsFs.js";
import { upsertDocument } from "./upsertDocument.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

const SOURCE = "liteko2";

/**
 * @param {object} sprendimas - liteko2Sprendimai eilutė.
 * @param {object} sidecar - sudarytiSidecar() rezultatas.
 * @param {object} [db]
 */
export async function upsertLiteko2ToDocuments(sprendimas, sidecar, db = postgres) {
    if (!sprendimas?.md5 || !sprendimas?.liteko2Id) {
        throw new Error("upsertLiteko2ToDocuments: trūksta md5 arba liteko2Id");
    }
    if (!sidecar || sidecar.md5 !== sprendimas.md5) {
        throw new Error("upsertLiteko2ToDocuments: sidecar md5 nesutampa");
    }

    await saveDocumentFs(sprendimas.md5, sidecar);

    await upsertDocument({
        class: sidecar.class,
        type: sidecar.type,
        source: SOURCE,
        url: `https://liteko-api-pub.teismas.lt/v1/decisions/${encodeURIComponent(sprendimas.liteko2Id)}`,
        md5: sprendimas.md5,
        title: sidecar.title ?? null,
        extension: sidecar.extension ?? null,
        mimeType: sidecar.extension === "html" ? "text/html" : null,
        language: "lt",
        wordCount: sidecar.wordCount ?? null,
        characterCount: sidecar.characterCount ?? null,
        happenedAt: sidecar.metadata?.sprendimoData ?? sprendimas.sprendimoData ?? null,
        sourceIds: [
            sidecar.saltinioId0 ?? null,
            sidecar.saltinioId1 ?? null,
            sprendimas.liteko2Id,
            null,
        ],
    }, db);

    if (db === postgres) {
        signalWork(WORK_SIGNALS.DOCUMENTS_INDEX_READY, {
            source: "liteko2",
            count: 1,
        });
    }
}
