import { APP_ENV } from "./runtimeContext.js";
import { publish } from "./natsHub.js";

const PREFIX = `viespirkiai.${APP_ENV}.work`;

export const WORK_SIGNALS = Object.freeze({
    FILES_DOWNLOAD_READY: `${PREFIX}.files.download.ready`,
    FILES_EXTRACTION_READY: `${PREFIX}.files.extraction.ready`,
    FILES_DOCUMENTS_READY: `${PREFIX}.files.documents.ready`,
    ETAR_DOCUMENTS_READY: `${PREFIX}.etar.documents.ready`,
    DOCUMENTS_INDEX_READY: `${PREFIX}.documents.index.ready`,
    SUTARTYS_CHANGED: `${PREFIX}.sutartys.changed`,
    VIESIEJI_PIRKIMAI_CHANGED: `${PREFIX}.viesieji-pirkimai.changed`,
    TED_NOTICES_READY: `${PREFIX}.ted.notices.ready`,
});

/** Signalas yra tik užuomina patikrinti patvarią PostgreSQL eilę. */
export function signalWork(subject, payload) {
    publish(subject, payload);
}
