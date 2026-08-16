import { postgres } from "../../../postgres/postgres.js";
import { signalWork, WORK_SIGNALS } from "../../../utils/taskSignals.js";
import {
    insertRows,
    loadFixedLookups,
    recordAnomalies,
    requireLookup,
    resolveVocabularies,
    vocabularyKey,
} from "./vocabularies.js";
import {
    ensureLegalActStubs,
    insertMetadata,
    insertRelatedInformation,
    markInTransaction,
    referencedActIds,
} from "./normalize.js";

/**
 * Įrašo pilną dokumento atsakymą (`/{id}`, `/{id}/asr` arba `/{id}/{edition}`).
 *
 * Nepakitęs `md5` reiškia, kad normalizuotas turinys identiškas — tokiu atveju
 * atnaujinam tik `fetchedAt`, vaikų neperrašom, o dokumentų eilės trigeris tokį
 * techninį atnaujinimą sąmoningai ignoruoja.
 * `force: true` apeina šį trumpąjį kelią (reikalinga, kai pasikeitė pati
 * normalizacija, o ne šaltinis).
 *
 * @param {Object} payload - LegalActDocument
 * @param {Object} opts
 * @param {string} opts.md5 - sidecar raktas (JSON be nepastovių laukų)
 * @param {{stage?: string, editionToken?: string}} [opts.mark] - ką pažymėti kaip atliktą toje pačioje tranzakcijoje
 * @param {boolean} [opts.force] - perrašyti net jei md5 nepasikeitė
 * @returns {Promise<{documentId: number, keitimas: "insert"|"patch"|null}>}
 */
export async function saveDocument(payload, { md5, mark = null, force = false } = {}) {
    const fixed = await loadFixedLookups();
    const anomalies = [];
    const vocab = await resolveVocabularies([payload], anomalies);
    const documentVariantId = requireLookup(fixed.documentVariant, payload.document_variant, "document_variant");

    const client = await postgres.connect();
    try {
        await client.query("BEGIN");

        // Senoji eilutė paimama PRIEŠ upsert'ą (ir užrakinama): iš `md5` skirtumo
        // matom, ar tai naujas dokumentas, ar pasikeitęs, ar visai nepakitęs.
        const { rows: [existing] } = await client.query(
            `SELECT "documentId", "md5" FROM "eTarLegalActDocument"
              WHERE "legalActId" = $1 AND "documentVariantId" = $2
                AND COALESCE("editionToken", '') = COALESCE($3, '')
              FOR UPDATE`,
            [payload.id, documentVariantId, payload.edition_token ?? null],
        );
        const keitimas = existing ? (existing.md5 === md5 && !force ? null : "patch") : "insert";

        if (keitimas === null) {
            await client.query(
                `UPDATE "eTarLegalActDocument" SET "fetchedAt" = $2 WHERE "documentId" = $1`,
                [existing.documentId, payload.fetched_at ?? new Date().toISOString()],
            );
            await markInTransaction(client, payload.id, mark);
            await client.query("COMMIT");
            return { documentId: Number(existing.documentId), keitimas: null };
        }

        await client.query(
            `INSERT INTO "eTarLegalAct" ("legalActId", "title", "fetchedAt")
             VALUES ($1, $2, now())
             ON CONFLICT ("legalActId") DO UPDATE
                SET "title" = COALESCE(EXCLUDED."title", "eTarLegalAct"."title"),
                    "fetchedAt" = now()`,
            [payload.id, payload.title ?? null],
        );
        await client.query(
            `INSERT INTO "eTarLegalActScrape" ("legalActId") VALUES ($1) ON CONFLICT DO NOTHING`,
            [payload.id],
        );
        await ensureLegalActStubs(client, referencedActIds(payload));

        const officialText = payload.official_text ?? {};
        const { rows: [{ documentId }] } = await client.query(
            `INSERT INTO "eTarLegalActDocument" (
                "legalActId", "documentVariantId", "editionToken", "sourceUrl", "title",
                "contentPresenceId", "contentMessage", "fetchedAt", "md5"
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT ("legalActId", "documentVariantId", COALESCE("editionToken", ''))
             DO UPDATE SET
                "sourceUrl" = EXCLUDED."sourceUrl",
                "title" = EXCLUDED."title",
                "contentPresenceId" = EXCLUDED."contentPresenceId",
                "contentMessage" = EXCLUDED."contentMessage",
                "fetchedAt" = EXCLUDED."fetchedAt",
                "md5" = EXCLUDED."md5"
             RETURNING "documentId"`,
            [
                payload.id,
                documentVariantId,
                payload.edition_token ?? null,
                payload.source_url,
                payload.title,
                requireLookup(fixed.presenceState, officialText.content_presence, "content_presence"),
                officialText.message ?? null,
                payload.fetched_at ?? new Date().toISOString(),
                md5,
            ],
        );

        // Vaikus perrašom, o ne bandom sulieti: šaltinis neturi stabilių vaikų id'ų.
        await client.query(`DELETE FROM "eTarOfficialTextResource" WHERE "documentId" = $1`, [documentId]);
        await client.query(`DELETE FROM "eTarDocumentMetadata" WHERE "documentId" = $1`, [documentId]);
        await client.query(`DELETE FROM "eTarRelatedSection" WHERE "documentId" = $1`, [documentId]);

        await insertRows(client, {
            table: "eTarOfficialTextResource",
            columns: ["documentId", "ordinal", "resourceFormatId", "url"],
            rows: (officialText.resources ?? []).map((resource, index) => ({
                documentId,
                ordinal: index,
                resourceFormatId: vocab.resourceFormat.get(vocabularyKey("resourceFormat", resource.format)),
                url: resource.url,
            })),
        });

        await insertMetadata(client, { documentId }, payload.metadata, vocab, fixed);
        await insertRelatedInformation(client, { documentId }, payload.related_information, vocab, fixed);
        await client.query(
            `INSERT INTO public."eTarDocumentsQueue" ("documentId", change)
             VALUES ($1, $2)`,
            [documentId, keitimas],
        );
        await markInTransaction(client, payload.id, mark);
        await recordAnomalies(client, payload.id, anomalies);
        await client.query("COMMIT");
        signalWork(WORK_SIGNALS.ETAR_DOCUMENTS_READY, {
            source: "eTar.saveDocument",
            count: 1,
        });
        return { documentId: Number(documentId), keitimas };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------
// redakcijų sąrašas
// ---------------------------------------------------------------

/**
 * Įrašo `/{id}/editions` atsakymą. Kaip ir `saveDocument`, nepakitęs md5 →
 * atnaujinam tik `fetchedAt`. Dokumentų paieškoje indeksuojamas pats dokumentas,
 * o ne redakcijų sąrašas.
 * @returns {Promise<{editionListId: number, keitimas: "insert"|"patch"|null}>}
 */
export async function saveEditionList(payload, { md5, mark = { stage: "editions" }, force = false } = {}) {
    const fixed = await loadFixedLookups();
    const anomalies = [];
    const vocab = await resolveVocabularies([payload], anomalies);

    const client = await postgres.connect();
    try {
        await client.query("BEGIN");

        const { rows: [existing] } = await client.query(
            `SELECT "editionListId", "md5" FROM "eTarEditionList" WHERE "legalActId" = $1 FOR UPDATE`,
            [payload.id],
        );
        const keitimas = existing ? (existing.md5 === md5 && !force ? null : "patch") : "insert";

        if (keitimas === null) {
            await client.query(
                `UPDATE "eTarEditionList" SET "fetchedAt" = $2 WHERE "editionListId" = $1`,
                [existing.editionListId, payload.fetched_at ?? new Date().toISOString()],
            );
            await markInTransaction(client, payload.id, mark);
            await client.query("COMMIT");
            return { editionListId: Number(existing.editionListId), keitimas: null };
        }

        await client.query(
            `INSERT INTO "eTarLegalAct" ("legalActId", "title", "fetchedAt")
             VALUES ($1, $2, now())
             ON CONFLICT ("legalActId") DO UPDATE
                SET "title" = COALESCE(EXCLUDED."title", "eTarLegalAct"."title"),
                    "fetchedAt" = now()`,
            [payload.id, payload.title ?? null],
        );
        await client.query(
            `INSERT INTO "eTarLegalActScrape" ("legalActId") VALUES ($1) ON CONFLICT DO NOTHING`,
            [payload.id],
        );
        await ensureLegalActStubs(client, referencedActIds(payload));

        const { rows: [{ editionListId }] } = await client.query(
            `INSERT INTO "eTarEditionList" (
                "legalActId", "sourceUrl", "title", "editionsPresenceId", "fetchedAt", "md5"
             ) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT ("legalActId") DO UPDATE SET
                "sourceUrl" = EXCLUDED."sourceUrl",
                "title" = EXCLUDED."title",
                "editionsPresenceId" = EXCLUDED."editionsPresenceId",
                "fetchedAt" = EXCLUDED."fetchedAt",
                "md5" = EXCLUDED."md5"
             RETURNING "editionListId"`,
            [
                payload.id,
                payload.source_url,
                payload.title,
                requireLookup(fixed.presenceState, payload.editions_presence, "editions_presence"),
                payload.fetched_at ?? new Date().toISOString(),
                md5,
            ],
        );

        // 4-o etapo progresas gyvena ant "eTarEdition"."scrapedAt", o eilutes perrašom —
        // tad prieš trynimą pasiimam žymas ir grąžinam jas toms pačioms redakcijoms.
        // Kartu keliauja ir klaidų skaitiklis su `retryAfter`: kitaip redakcijų
        // sąrašo atnaujinimas nutrintų backoff'ą ir lūžtanti redakcija iškart
        // grįžtų į eilę.
        const { rows: previous } = await client.query(
            `SELECT "editionToken", "scrapedAt", "failureCount", "lastError", "retryAfter"
               FROM "eTarEdition" WHERE "legalActId" = $1`,
            [payload.id],
        );
        const busenaByToken = new Map(previous.map(row => [row.editionToken, row]));

        await client.query(`DELETE FROM "eTarEdition" WHERE "editionListId" = $1`, [editionListId]);
        await client.query(`DELETE FROM "eTarDocumentMetadata" WHERE "editionListId" = $1`, [editionListId]);
        await client.query(`DELETE FROM "eTarRelatedSection" WHERE "editionListId" = $1`, [editionListId]);

        const editions = payload.editions ?? [];
        const returned = await insertRows(client, {
            table: "eTarEdition",
            columns: ["editionListId", "legalActId", "ordinal", "editionToken", "effectiveFrom", "effectiveTo", "url",
                "scrapedAt", "failureCount", "lastError", "retryAfter"],
            rows: editions.map((edition, index) => {
                const buvusi = busenaByToken.get(edition.edition_token);
                return {
                    editionListId,
                    legalActId: payload.id,
                    ordinal: index,
                    editionToken: edition.edition_token,
                    effectiveFrom: edition.effective_from,
                    effectiveTo: edition.effective_to ?? null,
                    url: edition.url,
                    scrapedAt: buvusi?.scrapedAt ?? null,
                    failureCount: buvusi?.failureCount ?? 0,
                    lastError: buvusi?.lastError ?? null,
                    retryAfter: buvusi?.retryAfter ?? null,
                };
            }),
            returning: `"ordinal", "editionId"`,
        });
        const editionIdByOrdinal = new Map(returned.map(row => [row.ordinal, row.editionId]));

        const changes = [];
        editions.forEach((edition, index) => {
            const editionId = editionIdByOrdinal.get(index);
            (edition.changes ?? []).forEach((change, changeIndex) => {
                changes.push({
                    editionId,
                    ordinal: changeIndex,
                    amendingActId: change.legal_act_id,
                    adoptedAt: change.adopted_at,
                    linkText: change.text,
                    url: change.url,
                });
            });
        });
        await insertRows(client, {
            table: "eTarEditionChange",
            columns: ["editionId", "ordinal", "amendingActId", "adoptedAt", "linkText", "url"],
            rows: changes,
        });

        await insertMetadata(client, { editionListId }, payload.metadata, vocab, fixed);
        await insertRelatedInformation(client, { editionListId }, payload.related_information, vocab, fixed);
        await markInTransaction(client, payload.id, mark);
        await recordAnomalies(client, payload.id, anomalies);

        await client.query("COMMIT");
        return { editionListId: Number(editionListId), keitimas };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

