import config from "../utils/config.js";

// Plonas Quickwit HTTP sluoksnis be jokių priklausomybių nuo Postgres – kad
// konsolinės komandos (countMetadataProducer, topPdfMetadata) galėtų kreiptis
// tiesiai į indeksų šabloną (`documents_*`), ko didysis quickwit.js API
// (search(lentele, …)) nedaro.

export const QW_URL = config.quickwitUrl ?? "http://localhost:7280";

/**
 * POST /api/v1/<pattern>/search su pateiktu body (query, max_hits, aggs…).
 * @param {string} pattern - indekso pavadinimas arba šablonas, pvz. „documents_*"
 * @param {object} body
 * @returns {Promise<object>} Quickwit atsakymas
 */
export async function searchIndexPattern(pattern, body) {
    const response = await fetch(`${QW_URL}/api/v1/${pattern}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`Quickwit search failed (${response.status}): ${await response.text()}`);
    }
    return response.json();
}
