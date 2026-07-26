// Ollama /api/embed klientas. Vienas backend'as arba N Ollamų už Caddy least-conn
// balansuotojo – klientui skirtumo nėra, keičiasi tik URL ir concurrency.
import { sleep } from "../../utils/time.js";

export const DEFAULT_OLLAMA_URL = "http://192.168.255.99:11434";
export const DEFAULT_EMBED_MODEL = "bge-m3";

/**
 * @typedef {Object} EmbedStats
 * @property {number} httpMs - suminis laikas HTTP kvietimuose (Σ per visus darbininkus)
 * @property {number} retries - kiek kartų teko kartoti
 */

/** @returns {EmbedStats} */
export function newEmbedStats() {
    return { httpMs: 0, retries: 0 };
}

/**
 * Sukuria embeddinimo klientą.
 * @param {Object} [opts]
 * @param {string} [opts.url] - Ollama (ar balansuotojo) bazinis adresas
 * @param {string} [opts.model]
 * @param {number} [opts.retries] - bandymų skaičius su exponential backoff
 * @param {number} [opts.maxBackoffMs]
 */
export function createOllamaEmbedder({
    url = DEFAULT_OLLAMA_URL,
    model = DEFAULT_EMBED_MODEL,
    retries = 5,
    maxBackoffMs = 8000,
} = {}) {
    const base = url.replace(/\/$/, "");

    /**
     * Vienas /api/embed kvietimas su batch input'u (su retry).
     * @param {string[]} texts
     * @param {EmbedStats} [stats]
     * @returns {Promise<number[][]>} embeddingai ta pačia tvarka kaip `texts`
     */
    async function embedBatch(texts, stats) {
        let lastErr;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const t0 = performance.now();
                const res = await fetch(`${base}/api/embed`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ model, input: texts }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
                const json = await res.json();
                const embeddings = json.embeddings;
                if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
                    throw new Error(`gavom ${embeddings?.length} embeddingų, laukėm ${texts.length}`);
                }
                if (stats) stats.httpMs += performance.now() - t0;
                return embeddings;
            } catch (error) {
                lastErr = error;
                if (stats) stats.retries++;
                await sleep(Math.min(500 * 2 ** (attempt - 1), maxBackoffMs));
            }
        }
        throw new Error(`embedBatch nepavyko po ${retries} bandymų: ${lastErr?.message}`);
    }

    /** Patogumui: vienas tekstas → vienas vektorius. */
    async function embedOne(text, stats) {
        const [vec] = await embedBatch([text], stats);
        return vec;
    }

    return { url: base, model, embedBatch, embedOne };
}
