import { postgres } from "../../postgres/postgres.js";
import { splitUrl } from "./url.js";

/*
Vieno ne failais paremto dokumento upsert'as.

Tapatybė tokiems dokumentams yra (šaltinis, md5): liteko, liteko2 ir teismo
nuosprendžiai taip elgėsi ir iki perkėlimo. e-TAR tapatybė kitokia (aktų
redakcijos gyvena ilgiau už savo tekstą), tad jis turi savo kelią –
upsertFromETar.js.

Dokumento eilutė ir jo documents."sourceIds" įrašas rašomi vienu sakiniu per
CTE, kad tarp jų negalėtų įsiterpti kitas rašytojas. Žodynų raktus išsprendžia
pati DB (documents.*_id funkcijos), tad čia nereikia nei kešo, nei papildomų
užklausų.
*/

/**
 * @param {object} doc
 * @param {string} doc.class - dokumento klasė, pvz. „teise".
 * @param {string} doc.type - tipas klasės viduje, pvz. „teismoNuosprendis".
 * @param {string} doc.source - šaltinis, pvz. „liteko2".
 * @param {string} doc.url - pilnas adresas; skaidomas į protokolą, hostą ir kelią.
 * @param {string} doc.md5 - turinio MD5 hex pavidalu (32 simboliai).
 * @param {string[]} [doc.sourceIds] - iki keturių šaltinio identifikatorių.
 * @param {string} [doc.parentMd5] - tėvinio dokumento md5 tame pačiame šaltinyje.
 * @param {object} [db]
 * @returns {Promise<number>} dokumento id.
 */
export async function upsertDocument(doc, db = postgres) {
    if (!doc?.md5) throw new Error("upsertDocument: trūksta md5");
    if (!doc?.url) throw new Error("upsertDocument: trūksta url");

    const { protocol, host, port, path } = splitUrl(doc.url);
    const [id0 = null, id1 = null, id2 = null, id3 = null] = doc.sourceIds ?? [];

    const { rows } = await db.query(
        `WITH doc AS (
            INSERT INTO documents.documents (
                "typeId", "sourceId", "protocolId", "hostId", path,
                md5, title, "authorId", "languageId", "extensionId", "mimeTypeId",
                "pageCount", "wordCount", "characterCount",
                "happenedAt", "discoveredAt", "createdAt", "institutionJarCode",
                parent
            ) VALUES (
                documents.type_id($1, $2), documents.source_id($3),
                documents.protocol_id($4), documents.host_id($5, $6), $7,
                decode($8, 'hex'), $9, documents.author_id($24),
                documents.language_id($10),
                documents.extension_id($11), documents.mime_type_id($12),
                $13, $14, $15, $16, $17, $18, $19,
                (SELECT p.id FROM documents.documents p
                  WHERE p."sourceId" = documents.source_id($3)
                    AND p.md5 = decode($25, 'hex')
                  LIMIT 1)
            )
            ON CONFLICT ("sourceId", md5) WHERE md5 IS NOT NULL DO UPDATE SET
                "typeId"             = EXCLUDED."typeId",
                "protocolId"         = EXCLUDED."protocolId",
                "hostId"             = EXCLUDED."hostId",
                path                 = EXCLUDED.path,
                title                = EXCLUDED.title,
                "authorId"           = EXCLUDED."authorId",
                "languageId"         = EXCLUDED."languageId",
                "extensionId"        = EXCLUDED."extensionId",
                "mimeTypeId"         = EXCLUDED."mimeTypeId",
                "pageCount"          = EXCLUDED."pageCount",
                "wordCount"          = EXCLUDED."wordCount",
                "characterCount"     = EXCLUDED."characterCount",
                "happenedAt"         = EXCLUDED."happenedAt",
                "createdAt"          = EXCLUDED."createdAt",
                "institutionJarCode" = EXCLUDED."institutionJarCode",
                -- Tėvas gali būti dar neįrašytas; jau rastos nuorodos netrinam.
                parent               = COALESCE(EXCLUDED.parent, documents.documents.parent)
            RETURNING id
         ), ids AS (
            -- Be nė vieno identifikatoriaus eilutės nerašom: visų NULL rinkinys
            -- pagal sourceIds_identity_unique susidurtų su kitu tokiu dokumentu.
            INSERT INTO documents."sourceIds" ("documentId", "sourceId", id0, id1, id2, id3)
            SELECT doc.id, documents.source_id($3), $20, $21, $22, $23
            FROM doc
            WHERE $20 IS NOT NULL OR $21 IS NOT NULL OR $22 IS NOT NULL OR $23 IS NOT NULL
            ON CONFLICT ("documentId") DO UPDATE SET
                id0 = EXCLUDED.id0,
                id1 = EXCLUDED.id1,
                id2 = EXCLUDED.id2,
                id3 = EXCLUDED.id3
         )
         SELECT id AS "documentId" FROM doc`,
        [
            doc.class, doc.type, doc.source,
            protocol, host, port, path,
            doc.md5, doc.title ?? null, doc.language ?? null,
            doc.extension ?? null, doc.mimeType ?? null,
            doc.pageCount ?? null, doc.wordCount ?? null, doc.characterCount ?? null,
            doc.happenedAt ?? null, doc.discoveredAt ?? null, doc.createdAt ?? null,
            doc.institutionJarCode ?? null,
            id0, id1, id2, id3,
            doc.author ?? null, doc.parentMd5 ?? null,
        ],
    );
    return rows[0].documentId;
}
