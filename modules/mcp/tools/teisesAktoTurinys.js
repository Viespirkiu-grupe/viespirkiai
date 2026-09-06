import { postgres } from "../../../postgres/postgres.js";
import { readETarSidecar } from "../../eTar/eTarSidecar.js";
import { readESeimasSidecar } from "../../eSeimas/eSeimasSidecar.js";

const LEGAL_ACT_TYPES = new Set(["teisesAktas", "teisesAktoProjektas"]);

function mcpError(text) {
    return { content: [{ type: "text", text }], isError: true };
}

function sourceReader(source) {
    const normalized = String(source ?? "").toLowerCase().replace(/[^a-z]/g, "");
    if (normalized === "etar") return readETarSidecar;
    if (normalized === "eseimas") return readESeimasSidecar;
    return null;
}

export function normalizeLegalActText(raw) {
    if (typeof raw !== "string") return "";
    return raw
        .replace(/^[ \t]+/gm, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function indexStructure(structure) {
    const byId = new Map();
    const parentById = new Map();
    const ordered = [];

    function walk(nodes, parentId = null, path = []) {
        for (const node of nodes ?? []) {
            if (!node?.part_id) continue;
            const id = String(node.part_id);
            const label = String(node.label ?? "").trim() || id;
            byId.set(id, node);
            parentById.set(id, parentId);
            ordered.push({ node, id, label, path: [...path, label] });
            walk(node.children, id, [...path, label]);
        }
    }
    walk(structure);
    return { byId, parentById, ordered };
}

export function subtreeText(node) {
    const parts = [];
    function walk(current) {
        const own = normalizeLegalActText(current?.text);
        if (own) parts.push(own);
        for (const child of current?.children ?? []) walk(child);
    }
    walk(node);
    return parts.join("\n\n");
}

export function contentRows(nodes) {
    return (nodes ?? []).filter((node) => node?.part_id).map((node) => ({
        partId: String(node.part_id),
        pavadinimas: String(node.label ?? "").trim() || String(node.part_id),
        vaikuKiekis: Array.isArray(node.children) ? node.children.length : 0,
        savoTekstoSimboliai: normalizeLegalActText(node.text).length,
        suPoskyriaisSimboliai: subtreeText(node).length,
    }));
}

export function visibleRootNodes(structure) {
    if (
        structure.length === 1
        && /^pagrindin(?:ė|e) dalis$/i.test(String(structure[0]?.label ?? "").trim())
        && Array.isArray(structure[0]?.children)
        && structure[0].children.length
    ) {
        return structure[0].children;
    }
    return structure;
}

export async function loadLegalActDocument(teisesAktoId, versijosId = "original") {
    // Viešame URL aktuali suvestinė redakcija vadinasi `asr` (/teisesAktas/:id/asr),
    // o dokumentų lentelėje – e-TAR varianto kodu.
    if (versijosId === "asr") versijosId = "consolidated_edition";
    const { rows } = await postgres.query(
        `SELECT d.id, d.md5, d.type, d.source, d.title AS pavadinimas, d.url,
                d."fileId" AS "failasId",
                EXISTS (
                    SELECT 1 FROM files."hidden" h WHERE h.id = d."fileId"
                ) AS pasleptas
           FROM documents."documentsFull" d
          WHERE d.class = 'teisekura'
            AND d."sourceId0" = $1
            AND (d."sourceId3" = $2 OR d."sourceId1" = $2)
          ORDER BY CASE WHEN d."sourceId3" = $2 THEN 0 ELSE 1 END
          LIMIT 1`,
        [teisesAktoId, versijosId],
    );
    if (!rows.length) {
        return {
            error: mcpError(
                `Teisės aktas ${teisesAktoId}, versija ${versijosId}, nerastas.`,
            ),
        };
    }

    const dokumentas = rows[0];
    if (dokumentas.pasleptas) {
        return { error: mcpError(`Teisės aktas ${teisesAktoId} nėra viešai pasiekiamas.`) };
    }
    if (!LEGAL_ACT_TYPES.has(dokumentas.type)) {
        return {
            error: mcpError(
                `${teisesAktoId} versija ${versijosId} nėra teisės aktas.`,
            ),
        };
    }
    if (!dokumentas.md5) {
        return { error: mcpError(`Teisės aktas ${teisesAktoId} neturi teksto saugyklos rakto.`) };
    }

    const read = sourceReader(dokumentas.source);
    if (!read) {
        return {
            error: mcpError(
                `Teisės akto šaltinis „${dokumentas.source ?? "nežinomas"}“ neturi struktūrinio teksto skaitytuvo. Naudok get_dokumentas_tekstas.`,
            ),
        };
    }

    const payload = await read(dokumentas.md5);
    if (!payload) {
        return { error: mcpError(`Teisės akto ${teisesAktoId} šaltinio tekstas nerastas.`) };
    }

    const officialText = payload?.official_text ?? {};
    const structure = Array.isArray(officialText.structure) ? officialText.structure : [];
    return {
        dokumentas,
        teisesAktoId,
        versijosId,
        text: normalizeLegalActText(officialText.text),
        structure,
        index: indexStructure(structure),
    };
}

export function legalActIdentity(dokumentas, teisesAktoId, versijosId) {
    return {
        dokumentoId: Number(dokumentas.id),
        teisesAktoId,
        versijosId,
        pavadinimas: dokumentas.pavadinimas ?? null,
        tipas: dokumentas.type,
        saltinis: dokumentas.source ?? null,
        url: dokumentas.url ?? null,
    };
}
