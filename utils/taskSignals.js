import { APP_ENV } from "./runtimeContext.js";
import { publish } from "./natsHub.js";

const PREFIX = `viespirkiai.${APP_ENV}.work`;

export const WORK_SIGNALS = Object.freeze({
    FILES_DOWNLOAD_READY: `${PREFIX}.files.download.ready`,
    FILES_EXTRACTION_READY: `${PREFIX}.files.extraction.ready`,
    FILES_DOCUMENTS_READY: `${PREFIX}.files.documents.ready`,
    FILES_OCR_READY: `${PREFIX}.files.ocr.ready`,
    ETAR_DOCUMENTS_READY: `${PREFIX}.etar.documents.ready`,
    ETAR_SCRAPE_READY: `${PREFIX}.etar.scrape.ready`,
    DOCUMENTS_INDEX_READY: `${PREFIX}.documents.index.ready`,
    DOMENAI_ADP_READY: `${PREFIX}.domenai.adp.ready`,
    JURIDINIAI_INDEX_READY: `${PREFIX}.juridiniai.index.ready`,
    SUTARTYS_CHANGED: `${PREFIX}.sutartys.changed`,
    VIESIEJI_PIRKIMAI_CHANGED: `${PREFIX}.viesieji-pirkimai.changed`,
    TED_NOTICES_READY: `${PREFIX}.ted.notices.ready`,
});

/** Signalas yra tik užuomina patikrinti patvarią PostgreSQL eilę. */
export function signalWork(subject, payload) {
    publish(subject, payload);
}
