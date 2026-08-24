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
(nuolatinis taskRunner darbas). Čia laikomos tik modelio variantų paieškos ir
vieno pirkimo aprašymo taisyklės — jokio lygiagretumo ar eilės logikos.
*/

export const DEFAULT_VARIANT = {
    platforma: "openrouter",
    tiekejas: "stealth",
    modelis: "ox-alpha",
    reasoningEffort: "max",
    maxOutputTokens: 4000,
    kontekstoIlgis: 1_000_000,
};

/** Aprašymo įrankiai — tie patys MCP įrankiai, adaptuoti OpenRouter formatui. */
export function aprasymoIrankiai() {
    return [getViesasisPirkimas, getFailas, getFailasTekstas].map(mcpAdapter);
}

/** Numatytasis modelio variantas; sukuriamas, jei dar neegzistuoja. */
export async function ensureDefaultVariant() {
    const { rows } = await postgres.query(
        `INSERT INTO public."aiModelVariants"
            ("platforma", "tiekejas", "modelis", "reasoningEffort",
             "maxOutputTokens", "kontekstoIlgis")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT "aiModelVariants_variantas_key"
         DO UPDATE SET
             "aktyvus" = true,
             "kontekstoIlgis" = COALESCE(
                 "aiModelVariants"."kontekstoIlgis",
                 EXCLUDED."kontekstoIlgis"
             )
         RETURNING *`,
        [
            DEFAULT_VARIANT.platforma,
            DEFAULT_VARIANT.tiekejas,
            DEFAULT_VARIANT.modelis,
            DEFAULT_VARIANT.reasoningEffort,
            DEFAULT_VARIANT.maxOutputTokens,
            DEFAULT_VARIANT.kontekstoIlgis,
        ],
    );
    return rows[0];
}

/**
 * @param {number|null} [id] - `aiModelVariants.id`; be jo grąžinamas numatytasis.
 * @returns {Promise<Record<string, any>>}
 */
export async function getVariant(id) {
    if (!id) return ensureDefaultVariant();
    const { rows } = await postgres.query(
        `SELECT * FROM public."aiModelVariants" WHERE "id" = $1`,
        [id],
    );
    if (!rows[0]) throw new Error(`aiModelVariants.id=${id} nerastas.`);
    return rows[0];
}

/** `aiModelVariants` eilutė → OpenRouter modelio pavadinimas. */
export function apiModel(variant) {
    if (variant.platforma !== "openrouter") {
        throw new Error(`Kol kas palaikoma tik openrouter platforma, gauta: ${variant.platforma}`);
    }
    return variant.modelis.includes("/")
        ? variant.modelis
        : `${variant.tiekejas}/${variant.modelis}`;
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
 * @returns {Promise<"issaugota"|"neaprasoma"|"jauBuvo">}
 */
export async function aprasytiPirkima({
    pirkimoId,
    variant,
    model,
    tools,
    apiKey,
    beforeRequest,
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
