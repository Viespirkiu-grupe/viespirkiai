const CPVA_DOCUMENT_PATH =
    "/dokumentai/cpva-adminstruojami-projektai-ir-tiekejai";

function baseUrl(url) {
    return new URL(url.endsWith("/") ? url : `${url}/`);
}

/** Sudaro CPVA dokumento puslapio URL pasirinktame mirror/proxy hoste. */
export function cpvaDocumentUrl(sourceBaseUrl) {
    return new URL(CPVA_DOCUMENT_PATH.slice(1), baseUrl(sourceBaseUrl)).href;
}

/**
 * Randa pirmą XLSX nuorodą ir jos kelią perkelia į tą patį mirror/proxy hostą.
 * Tai svarbu, kai upstream HTML pateikia absoliučią viešo domeno nuorodą.
 */
export function cpvaXlsxUrl(document, pageUrl, sourceBaseUrl) {
    for (const link of document.querySelectorAll("a[href]")) {
        const href = link.getAttribute("href");
        if (!href) continue;

        let upstreamUrl;
        try {
            upstreamUrl = new URL(href, pageUrl);
        } catch {
            continue;
        }

        if (!upstreamUrl.pathname.toLowerCase().endsWith(".xlsx")) continue;

        const mirroredUrl = baseUrl(sourceBaseUrl);
        mirroredUrl.pathname = upstreamUrl.pathname;
        mirroredUrl.search = upstreamUrl.search;
        mirroredUrl.hash = "";
        return mirroredUrl.href;
    }

    return null;
}
