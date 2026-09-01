import { saveDocumentFs } from "./documentsFs.js";
import { splitUrl } from "./url.js";

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

/** e-TAR raw sidecar + PG tapatybė → standartinis dokumento sidecar. */
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
            await saveDocumentFs(item.row.md5, item.sidecar);
        }
    }
    await Promise.all(Array.from({ length: Math.min(16, ready.length) }, worker));

    const col = (key) => ready.map((item) => item.row[key] ?? null);

    // e-TAR tapatybė yra (šaltinis, documentId), o ji gyvena documents."sourceIds",
    // ne pačioje dokumento eilutėje – akto redakcija išlieka ta pati, net kai
    // pasikeičia jos tekstas ar adresas. Todėl vienu ON CONFLICT neapsieinam:
    // esamas eilutes atnaujinam, naujas įrašom ir tik tada surašom tapatybes.
    //
    // Naujai įrašytas eilutes su įvestimi susiejam per md5: jį saugom pačioje
    // eilutėje, o documents_source_md5_unique garantuoja, kad šaltinio viduje
    // jis vienareikšmis.
    const urls = col("sourceUrl").map((url) => (url ? splitUrl(url) : null));

    await db.query(
        `WITH input AS (
            SELECT * FROM unnest(
                $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                $6::text[], $7::int[], $8::int[],
                $9::timestamptz[], $10::timestamptz[], $11::timestamptz[],
                $12::text[], $13::text[], $14::int[], $15::text[]
            ) AS t(md5, s0, s1, s2, s3, title, words, characters,
                   discovered, created, happened,
                   protocol, host, port, path)
         ), resolved AS (
            SELECT i.*, si."documentId"
            FROM input i
            LEFT JOIN documents."sourceIds" si
              ON si."sourceId" = documents.source_id($18) AND si.id2 = i.s2
         ), updated AS (
            UPDATE documents.documents d SET
                "typeId"         = documents.type_id($16, $17),
                "sourceId"       = documents.source_id($18),
                "protocolId"     = documents.protocol_id(r.protocol),
                "hostId"         = documents.host_id(r.host, r.port),
                path             = r.path,
                md5              = decode(r.md5, 'hex'),
                title            = r.title,
                "languageId"     = documents.language_id($19),
                "wordCount"      = r.words,
                "characterCount" = r.characters,
                "createdAt"      = r.created,
                "happenedAt"     = r.happened
            FROM resolved r
            WHERE d.id = r."documentId"
            RETURNING d.id
         ), inserted AS (
            INSERT INTO documents.documents (
                "typeId", "sourceId", "protocolId", "hostId", path,
                md5, title, "languageId", "wordCount", "characterCount",
                "discoveredAt", "createdAt", "happenedAt"
            )
            SELECT
                documents.type_id($16, $17), documents.source_id($18),
                documents.protocol_id(r.protocol), documents.host_id(r.host, r.port),
                r.path, decode(r.md5, 'hex'), r.title, documents.language_id($19),
                r.words, r.characters, r.discovered, r.created, r.happened
            FROM resolved r
            WHERE r."documentId" IS NULL
            RETURNING id, md5
         ), pairs AS (
            SELECT r.*, COALESCE(r."documentId", i.id) AS "docId"
            FROM resolved r
            LEFT JOIN inserted i ON i.md5 = decode(r.md5, 'hex')
         )
         INSERT INTO documents."sourceIds" ("documentId", "sourceId", id0, id1, id2, id3)
         SELECT p."docId", documents.source_id($18), p.s0, p.s1, p.s2, p.s3
         FROM pairs p
         WHERE p."docId" IS NOT NULL
         ON CONFLICT ("documentId") DO UPDATE SET
            id0 = EXCLUDED.id0,
            id1 = EXCLUDED.id1,
            id2 = EXCLUDED.id2,
            id3 = EXCLUDED.id3`,
        [
            col("md5"), col("legalActId"), col("variantas"),
            col("documentId"), col("editionToken"), col("title"),
            col("wordCount"), col("characterCount"),
            col("discoveredAt"), col("createdAt"), col("happenedAt"),
            urls.map((u) => u?.protocol ?? null),
            urls.map((u) => u?.host ?? null),
            urls.map((u) => u?.port ?? null),
            urls.map((u) => u?.path ?? null),
            ETAR_CLASS, ETAR_TYPE, ETAR_SOURCE, "lt",
        ],
    );
    return { upserted: ready.length, skipped: items.length - ready.length };
}

export async function deleteETarDocuments(documentIds, db) {
    if (!documentIds.length) return 0;
    const { rowCount } = await db.query(
        `DELETE FROM documents.documents d
         USING documents."sourceIds" si
         WHERE si."documentId" = d.id
           AND si."sourceId" = documents.source_id($2)
           AND si.id2 = ANY($1::text[])`,
        [documentIds.map(String), ETAR_SOURCE],
    );
    return rowCount ?? 0;
}
