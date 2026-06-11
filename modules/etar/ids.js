export function actIdFromUrl(url) {
    return url?.match(/\/legalAct\/([^/?#]+)/)?.[1] ?? null;
}

export function editionSourceIdFromUrl(url, rootId = actIdFromUrl(url)) {
    if (!url || !rootId) return null;
    try {
        const parsed = new URL(url, "https://e-tar.lt");
        const editionId = parsed.searchParams.get("editionId")
            ?? parsed.searchParams.get("actualEditionId")
            ?? parsed.searchParams.get("documentId");
        if (editionId && editionId !== rootId) return `${rootId}:edition:${editionId}`;

        const parts = parsed.pathname.split("/").filter(Boolean);
        const rootIndex = parts.findIndex((part) => part === rootId);
        const trailing = rootIndex >= 0 ? parts[rootIndex + 1] : null;
        return trailing ? `${rootId}:edition:${trailing}` : null;
    } catch {
        return null;
    }
}
