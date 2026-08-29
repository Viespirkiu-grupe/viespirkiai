import { createHash } from "node:crypto";
import { saveDocumentFs } from "../documents/documentsFs.js";
import { upsertDocument } from "../documents/upsertDocument.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

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

    await saveDocumentFs(md5, sidecar);

    // Tapatybė nepakito: md5 čia stabilus (md5(source:sourceId)), tad konfliktas
    // pagal (šaltinis, md5) yra tas pats, kas senasis (source, saltinioId2).
    // Tėvas randamas pagal tėvinio dokumento stabilų md5 tame pačiame šaltinyje.
    const id = await upsertDocument({
        class: TEISEKURA_CLASS,
        type: input.type,
        source: input.source,
        url: input.url,
        md5,
        title: input.title ?? null,
        author: input.author ?? null,
        language: input.language ?? "lt",
        pageCount: text ? 1 : null,
        wordCount,
        characterCount,
        discoveredAt: input.discoveredAt ?? new Date(),
        createdAt: input.createdAt ?? null,
        happenedAt: input.happenedAt ?? null,
        sourceIds: [
            input.rootSourceId,
            input.parentSourceId ?? null,
            input.sourceId,
            input.registracijosNr ?? null,
        ],
        parentMd5: input.parentSourceId
            ? stableMd5(input.source, input.parentSourceId)
            : null,
    });

    signalWork(WORK_SIGNALS.DOCUMENTS_INDEX_READY, {
        source: input.source,
        count: 1,
    });

    return { id, sidecar, md5, contentHash: contentHash(sidecar) };
}
