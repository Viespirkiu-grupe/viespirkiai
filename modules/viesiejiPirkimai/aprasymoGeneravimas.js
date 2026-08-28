import { postgres } from "../../postgres/postgres.js";
import * as getViesasisPirkimas from "../mcp/tools/getViesasisPirkimas.js";
import * as getFailas from "../mcp/tools/getFailas.js";
import * as getFailasTekstas from "../mcp/tools/getFailasTekstas.js";
import { isFailureResult, runPirkimoAprasas } from "./pirkimoAprasasHarness.js";
import { mcpAdapter } from "../openrouter/mcpAdapter.js";

/*
Vieno pirkimo AI aprašymo generavimas ir įrašymas.

Bendra dalis dviem kviečiantiesiems: `scripts/aprasytiPirkimus.js` (masinis
backfill'as su progreso išvedimu) ir `modules/viesiejiPirkimai/aprasymuEile.js`
(nuolatinis taskRunner darbas). Čia laikomos tik vieno pirkimo aprašymo
taisyklės — jokio lygiagretumo ar eilės logikos. Kuriuo modeliu aprašoma,
sprendžia DB (žr. modules/openrouter/modelioVariantai.js).
*/

/** Aprašymo įrankiai — tie patys MCP įrankiai, adaptuoti OpenRouter formatui. */
export function aprasymoIrankiai() {
    return [getViesasisPirkimas, getFailas, getFailasTekstas].map(mcpAdapter);
}

/**
 * Aprašo vieną pirkimą ir įrašo rezultatą į `viesiejiPirkimaiAprasymai`.
 *
 * Klaidos NEgaudomos — jas tvarko kviečiantysis (eilė daro atsitraukimą,
 * script'as tik suskaičiuoja). „Nepakanka duomenų" nėra klaida: tai galutinis
 * atsakymas, įrašomas kaip `success = false`.
 *
 * @param {object} p
 * @param {number|string} p.pirkimoId
 * @param {Record<string, any>} p.variant - `aiModelVariants` eilutė
 * @param {string} p.model - `apiModel(variant)`
 * @param {object[]} p.tools - `aprasymoIrankiai()`
 * @param {string} p.apiKey
 * @param {() => Promise<void>} [p.beforeRequest] - RPS ribotuvas
 * @param {(event: object) => void} [p.onEvent] - harness'o įvykiai (užklausų
 *   žurnalui; žr. `modules/viesiejiPirkimai/uzklausuZurnalas.js`)
 * @returns {Promise<"issaugota"|"neaprasoma"|"jauBuvo">}
 */
export async function aprasytiPirkima({
    pirkimoId,
    variant,
    model,
    tools,
    apiKey,
    beforeRequest,
    onEvent,
}) {
    const aprasymas = await runPirkimoAprasas({
        pirkimoId: String(pirkimoId),
        apiKey,
        tools,
        model,
        reasoningEffort: variant.reasoningEffort,
        maxOutputTokens: variant.maxOutputTokens ?? 4000,
        temperature: variant.temperatura,
        topP: variant.topP,
        topK: variant.topK,
        beforeRequest,
        onEvent,
    });

    const success = !isFailureResult(aprasymas);
    const result = await postgres.query(
        `INSERT INTO public."viesiejiPirkimaiAprasymai"
            ("pirkimoId", "modelioVariantasId", "success", "aprasymas")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("pirkimoId", "modelioVariantasId") DO NOTHING`,
        [pirkimoId, variant.id, success, success ? aprasymas : null],
    );

    if (result.rowCount !== 1) return "jauBuvo";
    return success ? "issaugota" : "neaprasoma";
}
