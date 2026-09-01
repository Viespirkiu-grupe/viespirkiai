import {
    insertRows,
    requireLookup,
    vocabularyKey,
} from "./vocabularies.js";

/** Nuorodose minimi aktai turi egzistuoti dėl FK — sukuriam stub'us ir įmetam į eilę. */
export async function ensureLegalActStubs(client, category, ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return;
    await client.query(
        `INSERT INTO "eSeimas"."legalAct" ("category", "legalActId")
         SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [category, unique],
    );
    await client.query(
        `INSERT INTO "eSeimas"."legalActScrape" ("category", "legalActId")
         SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [category, unique],
    );
}

export async function markInTransaction(client, category, legalActId, mark) {
    if (!mark) return;
    if (mark.stage) {
        const column = {
            document: "documentScrapedAt",
            editions: "editionsScrapedAt",
            asr: "asrScrapedAt",
        }[mark.stage];
        if (!column) throw new Error(`Nežinomas etapas: ${mark.stage}`);
        await client.query(
            `UPDATE "eSeimas"."legalActScrape"
                SET "${column}" = now(), "failureCount" = 0, "lastError" = NULL, "retryAfter" = NULL
              WHERE "category" = $1 AND "legalActId" = $2`,
            [category, legalActId],
        );
    }
    if (mark.editionToken) {
        await client.query(
            `UPDATE "eSeimas"."edition"
                SET "scrapedAt" = now(), "failureCount" = 0, "lastError" = NULL, "retryAfter" = NULL
              WHERE "category" = $1 AND "legalActId" = $2 AND "editionToken" = $3`,
            [category, legalActId, mark.editionToken],
        );
    }
}

// ---------------------------------------------------------------
// metaduomenys (bendri dokumentui ir redakcijų sąrašui)
// ---------------------------------------------------------------

export async function insertMetadata(client, owner, metadata, vocab, fixed) {
    if (!metadata) return;
    if (!["legal_act", "legal_act_project"].includes(metadata.profile)) {
        throw new Error(`e-Seimas: nepažįstamas metadata.profile „${metadata.profile}“`);
    }

    const registration = metadata.fields?.registration_details?.value ?? {};
    const { rows: [{ metadataId }] } = await client.query(
        `INSERT INTO "eSeimas"."documentMetadata" (
            "profile", "documentId", "editionListId", "actStatusId", "statusPresenceId",
            "effectiveFrom", "effectiveTo", "effectiveNote", "effectiveUntilNote",
            "registrationText", "registrationDate", "registrationNumber"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING "metadataId"`,
        [
            metadata.profile,
            owner.documentId ?? null,
            owner.editionListId ?? null,
            vocab.actStatus.get(vocabularyKey("actStatus", metadata.status)) ?? null,
            requireLookup(fixed.presenceState, metadata.status_presence, "status_presence"),
            metadata.effective_from ?? null,
            metadata.effective_to ?? null,
            metadata.effective_note ?? null,
            metadata.effective_until_note ?? null,
            registration.text ?? null,
            registration.date ?? null,
            registration.number ?? null,
        ],
    );

    await insertMetadataFields(client, metadataId, metadata.fields ?? {}, vocab, fixed);

    await insertRows(client, {
        table: "chronologyEvent",
        columns: ["metadataId", "ordinal", "eventDate", "event"],
        rows: (metadata.chronology ?? []).map((event, index) => ({
            metadataId,
            ordinal: index,
            eventDate: event.date ?? null,
            event: event.event ?? null,
        })),
    });
}

/** Tuščių laukų (nei reikšmės, nei nuorodų) nesaugom — informacijos jie neneša. */
function isEmptyField(field) {
    if (!field) return true;
    const hasLinks = (field.links ?? []).length > 0;
    const value = field.value;
    if (Array.isArray(value)) return value.length === 0 && !hasLinks;
    if (value && typeof value === "object") {
        return Object.values(value).every(v => v == null) && !hasLinks;
    }
    return (value == null || value === "") && !hasLinks;
}

async function insertMetadataFields(client, metadataId, fields, vocab, fixed) {
    const present = Object.entries(fields).filter(([, field]) => !isEmptyField(field));
    if (!present.length) return;

    const returned = await insertRows(client, {
        table: "metadataField",
        columns: ["metadataId", "metadataFieldKeyId", "valueText"],
        rows: present.map(([code, field]) => {
            const key = requireLookup(fixed.metadataFieldKey, code, "metadataFieldKey");
            return {
                metadataId,
                metadataFieldKeyId: key.id,
                // list/registration reikšmės gyvena atskirose lentelėse/stulpeliuose.
                valueText: key.valueKind === "scalar" ? field.value ?? null : null,
            };
        }),
        returning: `"metadataFieldKeyId", "metadataFieldId"`,
    });
    const fieldIdByKey = new Map(returned.map(row => [row.metadataFieldKeyId, row.metadataFieldId]));

    const links = [];
    const terms = [];
    for (const [code, field] of present) {
        const key = fixed.metadataFieldKey.get(code);
        const metadataFieldId = fieldIdByKey.get(key.id);

        (field.links ?? []).forEach((link, index) => {
            links.push({ metadataFieldId, ordinal: index, linkText: link.text, url: link.url });
        });

        if (key.valueKind === "list") {
            // UNIQUE (metadataFieldId, eurovocTermId) — pasikartojantį terminą praleidžiam.
            const seen = new Set();
            for (const term of field.value ?? []) {
                const eurovocTermId = vocab.eurovocTerm.get(vocabularyKey("eurovocTerm", term));
                if (eurovocTermId == null || seen.has(eurovocTermId)) continue;
                seen.add(eurovocTermId);
                terms.push({ metadataFieldId, ordinal: seen.size - 1, eurovocTermId });
            }
        }
    }

    await insertRows(client, {
        table: "metadataFieldLink",
        columns: ["metadataFieldId", "ordinal", "linkText", "url"],
        rows: links,
    });
    await insertRows(client, {
        table: "metadataFieldEurovocTerm",
        columns: ["metadataFieldId", "ordinal", "eurovocTermId"],
        rows: terms,
    });
}

// ---------------------------------------------------------------
// susijusi informacija
// ---------------------------------------------------------------

export async function insertRelatedInformation(client, owner, related, vocab, fixed) {
    for (const [code, section] of Object.entries(related ?? {})) {
        if (!section?.items?.length) continue;
        const type = requireLookup(fixed.relatedSectionType, code, "related_information skiltis");

        const { rows: [{ relatedSectionId }] } = await client.query(
            `INSERT INTO "eSeimas"."relatedSection" ("documentId", "editionListId", "relatedSectionTypeId", "sourceLabel")
             VALUES ($1,$2,$3,$4) RETURNING "relatedSectionId"`,
            [owner.documentId ?? null, owner.editionListId ?? null, type.id, section.source_label],
        );

        if (type.payloadKind === "attachment") {
            await insertAttachments(client, relatedSectionId, section.items, vocab);
        } else {
            await insertRelations(client, relatedSectionId, section.items, vocab);
        }
    }
}

async function insertAttachments(client, relatedSectionId, items, vocab) {
    const returned = await insertRows(client, {
        table: "attachment",
        columns: ["relatedSectionId", "ordinal", "filename", "attachmentName"],
        rows: items.map((item, index) => ({
            relatedSectionId,
            ordinal: index,
            filename: item.filename,
            attachmentName: item.attachment_name ?? null,
        })),
        returning: `"ordinal", "attachmentId"`,
    });
    const idByOrdinal = new Map(returned.map(row => [row.ordinal, row.attachmentId]));

    const resources = [];
    items.forEach((item, index) => {
        const attachmentId = idByOrdinal.get(index);
        // UNIQUE (attachmentId, resourceFormatId) — jei šaltinis kartoja tą patį
        // formatą, paliekam pirmą URL.
        const seen = new Set();
        for (const resource of item.resources ?? []) {
            const resourceFormatId = vocab.resourceFormat.get(vocabularyKey("resourceFormat", resource.format));
            if (resourceFormatId == null || seen.has(resourceFormatId)) continue;
            seen.add(resourceFormatId);
            resources.push({ attachmentId, ordinal: seen.size - 1, resourceFormatId, url: resource.url });
        }
    });

    await insertRows(client, {
        table: "attachmentResource",
        columns: ["attachmentId", "ordinal", "resourceFormatId", "url"],
        rows: resources,
    });
}

async function insertRelations(client, relatedSectionId, items, vocab) {
    const returned = await insertRows(client, {
        table: "legalActRelation",
        columns: [
            "relatedSectionId", "ordinal", "relationTypeId", "targetLegalActId",
            "actTypeId", "documentNumber", "adoptedAt", "title", "url",
        ],
        rows: items.map((item, index) => ({
            relatedSectionId,
            ordinal: index,
            relationTypeId: vocab.relationType.get(vocabularyKey("relationType", item.relation_type)),
            targetLegalActId: item.legal_act_id,
            actTypeId: vocab.actType.get(vocabularyKey("actType", item.act_type)) ?? null,
            documentNumber: item.document_number ?? null,
            adoptedAt: item.adopted_at ?? null,
            title: item.title,
            url: item.url,
        })),
        returning: `"ordinal", "relationId"`,
    });
    const idByOrdinal = new Map(returned.map(row => [row.ordinal, row.relationId]));

    const institutions = [];
    items.forEach((item, index) => {
        const relationId = idByOrdinal.get(index);
        const seen = new Set();
        for (const name of item.institutions ?? []) {
            const institutionId = vocab.institution.get(vocabularyKey("institution", name));
            if (institutionId == null || seen.has(institutionId)) continue;
            seen.add(institutionId);
            institutions.push({ relationId, ordinal: seen.size - 1, institutionId });
        }
    });

    await insertRows(client, {
        table: "legalActRelationInstitution",
        columns: ["relationId", "ordinal", "institutionId"],
        rows: institutions,
    });
}

// ---------------------------------------------------------------
// dokumentas
// ---------------------------------------------------------------

export function referencedActIds(payload) {
    const ids = [];
    for (const section of Object.values(payload.related_information ?? {})) {
        for (const item of section?.items ?? []) {
            if (item.kind !== "attachment" && item.legal_act_id) ids.push(item.legal_act_id);
        }
    }
    for (const edition of payload.editions ?? []) {
        for (const change of edition.changes ?? []) {
            if (change.legal_act_id) ids.push(change.legal_act_id);
        }
    }
    return ids;
}

