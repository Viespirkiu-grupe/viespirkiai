import { saveDokumentasFs } from "./dokumentaiFs.js";

export const ETAR_CLASS = "teisekura";
export const ETAR_TYPE = "teisesAktas";
export const ETAR_SOURCE = "etar";

function value(field) {
    const raw = field?.value;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed && trimmed !== "Nėra" ? trimmed : null;
}

function isoDate(value) {
    const text = typeof value === "string" ? value.trim() : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function scalarText(raw) {
    if (raw == null) return null;
    const text = String(raw).trim();
    return text && text !== "Nėra" ? text : null;
}

/** e-TAR raw sidecar + PG tapatybė → standartinis dokumentai sidecar. */
export function buildETarDokumentas(row, payload) {
    const rawMetadata = payload?.metadata ?? {};
    const fields = rawMetadata.fields ?? {};
    const registration = fields.registration_details?.value ?? {};
    const text = payload?.official_text?.text?.trim() || null;
    const adoptedAt = isoDate(value(fields.adopted_at));
    const registrationDate = isoDate(registration.date);
    const effectiveFrom = isoDate(rawMetadata.effective_from);
    const prieme = value(fields.adopted_by);
    const istaigosNr = value(fields.institution_number);
    const registracijosNr = scalarText(registration.number);
    const eurovocTerminai = Array.isArray(fields.eurovoc_terms?.value)
        ? fields.eurovoc_terms.value.map(String).map((v) => v.trim()).filter(Boolean)
        : [];

    const metadata = {
        rusis: value(fields.act_type),
        galiojimas: rawMetadata.status ?? null,
        editionType: row.variantas ?? payload?.document_variant ?? null,
        prieme,
        eurovocTerminai,
        turinioBusena: row.turinioBusena ?? payload?.official_text?.content_presence ?? null,
        istaigosNr,
        registracijosNr,
    };
    const jarKodai = [...new Set(text?.match(/\b\d{9}\b/g) ?? [])].map(Number);
    const wordCount = text ? (text.match(/\S+/g) ?? []).length : null;
    const characterCount = text?.length ?? null;

    return {
        row: {
            documentId: String(row.documentId),
            md5: row.md5,
            legalActId: row.legalActId,
            variantas: metadata.editionType,
            editionToken: row.editionToken ?? null,
            sourceUrl: row.sourceUrl ?? payload?.source_url ?? null,
            title: row.title ?? payload?.title ?? null,
            happenedAt: adoptedAt ?? registrationDate ?? effectiveFrom,
            createdAt: registrationDate,
            discoveredAt: row.fetchedAt ?? null,
            wordCount,
            characterCount,
        },
        sidecar: {
            version: "1",
            md5: row.md5,
            class: ETAR_CLASS,
            type: ETAR_TYPE,
            source: ETAR_SOURCE,
            saltinioId0: row.legalActId,
            saltinioId1: metadata.editionType,
            saltinioId2: String(row.documentId),
            saltinioId3: row.editionToken ?? null,
            author: null,
            title: row.title ?? payload?.title ?? null,
            extension: null,
            pageCount: null,
            wordCount,
            characterCount,
            text,
            jarKodai,
            metadata,
            etar: {
                effectiveFrom,
                effectiveTo: isoDate(rawMetadata.effective_to),
                registrationDate,
            },
        },
    };
}

/** Išsaugo sidecar'us ir vienu SQL upsert'ina dokumentų porciją. */
export async function upsertETarBatch(items, db) {
    const ready = items.filter((item) => item?.row?.md5 && item?.row?.documentId);
    if (!ready.length) return { upserted: 0, skipped: items.length };

    let cursor = 0;
    async function worker() {
        while (cursor < ready.length) {
            const item = ready[cursor++];
            await saveDokumentasFs(item.row.md5, item.sidecar);
        }
    }
    await Promise.all(Array.from({ length: Math.min(16, ready.length) }, worker));

    const col = (key) => ready.map((item) => item.row[key] ?? null);
    await db.query(
        `INSERT INTO public.dokumentai (
            md5, class, type, host, domain, url, source,
            "saltinioId0", "saltinioId1", "saltinioId2", "saltinioId3",
            pavadinimas, language, "wordCount", "characterCount",
            "discoveredAt", "createdAt", "happenedAt"
         )
         SELECT t.md5, $13, $14, 'e-tar.lt', 'e-tar.lt', t.url, $15,
                t.s0, t.s1, t.s2, t.s3, t.title, 'lt', t.words, t.characters,
                t.discovered, t.created, t.happened
         FROM unnest(
            $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
            $6::text[], $7::text[], $8::int[], $9::int[],
            $10::timestamptz[], $11::timestamptz[], $12::timestamptz[]
         ) AS t(md5, url, s0, s1, s2, s3, title,
                words, characters, discovered, created, happened)
         ON CONFLICT (source, "saltinioId2") WHERE class = 'teisekura' DO UPDATE SET
            md5              = EXCLUDED.md5,
            type             = EXCLUDED.type,
            host             = EXCLUDED.host,
            domain           = EXCLUDED.domain,
            url              = EXCLUDED.url,
            "saltinioId0"    = EXCLUDED."saltinioId0",
            "saltinioId1"    = EXCLUDED."saltinioId1",
            "saltinioId3"    = EXCLUDED."saltinioId3",
            pavadinimas      = EXCLUDED.pavadinimas,
            language         = EXCLUDED.language,
            "wordCount"      = EXCLUDED."wordCount",
            "characterCount" = EXCLUDED."characterCount",
            "createdAt"      = EXCLUDED."createdAt",
            "happenedAt"     = EXCLUDED."happenedAt"`,
        [
            col("md5"), col("sourceUrl"), col("legalActId"), col("variantas"),
            col("documentId"), col("editionToken"), col("title"),
            col("wordCount"), col("characterCount"), col("discoveredAt"),
            col("createdAt"), col("happenedAt"),
            ETAR_CLASS, ETAR_TYPE, ETAR_SOURCE,
        ],
    );
    return { upserted: ready.length, skipped: items.length - ready.length };
}

export async function deleteETarDokumentai(documentIds, db) {
    if (!documentIds.length) return 0;
    const { rowCount } = await db.query(
        `DELETE FROM public.dokumentai
         WHERE class = 'teisekura' AND source = 'etar'
           AND "saltinioId2" = ANY($1::text[])`,
        [documentIds.map(String)],
    );
    return rowCount ?? 0;
}
