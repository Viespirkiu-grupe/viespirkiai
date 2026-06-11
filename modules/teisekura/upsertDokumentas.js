import { createHash } from "node:crypto";
import { postgres } from "../../postgres/postgres.js";
import { saveDokumentasFs } from "../dokumentai/dokumentaiFs.js";

export const TEISEKURA_CLASS = "teisekura";

export function stableMd5(source, sourceId) {
    return createHash("md5").update(`${source}:${sourceId}`).digest("hex");
}

export function contentHash(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function upsertTeisekuraDokumentas(input) {
    const md5 = stableMd5(input.source, input.sourceId);
    const text = input.text?.trim() || null;
    const wordCount = text ? (text.match(/\S+/g) ?? []).length : null;
    const characterCount = text?.length ?? null;
    const jarKodai = [...new Set(text?.match(/\b\d{9}\b/g) ?? [])].map(Number);

    const sidecar = {
        version: String(input.version ?? 1),
        md5,
        class: TEISEKURA_CLASS,
        type: input.type,
        source: input.source,
        saltinioId0: input.rootSourceId,
        saltinioId1: input.parentSourceId ?? null,
        saltinioId2: input.sourceId,
        saltinioId3: input.registracijosNr ?? null,
        author: input.author ?? null,
        title: input.title ?? null,
        text,
        jarKodai,
        metadata: input.metadata ?? {},
    };

    await saveDokumentasFs(md5, sidecar);

    const { rows } = await postgres.query(
        `INSERT INTO public.dokumentai (
            md5, class, type, host, domain, url, source,
            "saltinioId0", "saltinioId1", "saltinioId2", "saltinioId3",
            autorius, pavadinimas, language, "pageCount", "wordCount",
            "characterCount", "discoveredAt", "createdAt", "happenedAt", parent
         ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
            COALESCE($18, now()),$19,$20,
            (SELECT id FROM public.dokumentai
             WHERE class = 'teisekura' AND source = $7 AND "saltinioId2" = $9 LIMIT 1)
         )
         ON CONFLICT (source, "saltinioId2") WHERE class = 'teisekura' DO UPDATE SET
            md5 = EXCLUDED.md5, type = EXCLUDED.type, host = EXCLUDED.host,
            domain = EXCLUDED.domain, url = EXCLUDED.url,
            "saltinioId0" = EXCLUDED."saltinioId0",
            "saltinioId1" = EXCLUDED."saltinioId1",
            "saltinioId3" = EXCLUDED."saltinioId3",
            autorius = EXCLUDED.autorius, pavadinimas = EXCLUDED.pavadinimas,
            language = EXCLUDED.language, "pageCount" = EXCLUDED."pageCount",
            "wordCount" = EXCLUDED."wordCount",
            "characterCount" = EXCLUDED."characterCount",
            "createdAt" = EXCLUDED."createdAt", "happenedAt" = EXCLUDED."happenedAt",
            parent = COALESCE(EXCLUDED.parent, public.dokumentai.parent)
         RETURNING *`,
        [
            md5, TEISEKURA_CLASS, input.type, input.host, input.domain, input.url,
            input.source, input.rootSourceId, input.parentSourceId ?? null,
            input.sourceId, input.registracijosNr ?? null, input.author ?? null,
            input.title ?? null, input.language ?? "lt", text ? 1 : null,
            wordCount, characterCount, input.discoveredAt ?? null,
            input.createdAt ?? null, input.happenedAt ?? null,
        ],
    );

    return { row: rows[0], sidecar, md5, contentHash: contentHash(sidecar) };
}
