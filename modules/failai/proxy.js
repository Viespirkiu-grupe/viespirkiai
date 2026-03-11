import mime from "mime";
import { Readable } from "stream";

export function buildProxyResponse(failas, deze, parent = null) {
    const contentType =
        mime.getType(failas.extension) || "application/octet-stream";
    const contentLength = Number(failas.dydis) || undefined;
    const base = {
        extension: failas.extension,
        fileName: failas.pavadinimas,
        contentType,
        contentLength,
    };

    if (!parent)
        return {
            ...base,
            fileUrl: `${deze.url}/file/${failas.md5}.${failas.extension}`,
            headers: { "x-api-key": deze.apiKey },
        };

    const parentExt = String(parent.extension).toLowerCase();
    const fileUrl = `${deze.url}/file/${parent.md5}.${parent.extension}`;

    if (["zip", "adoc", "rar"].includes(parentExt))
        return {
            ...base,
            fileUrl: `${fileUrl}?extract=${encodeURIComponent(failas.saltinioId)}`,
        };

    return {
        ...base,
        fileUrl,
        extract: failas.saltinioId,
        containerExtension: parentExt,
        headers: { "x-api-key": deze.apiKey },
    };
}

export async function streamRemoteFile(
    res,
    url,
    { contentDisposition, contentType },
) {
    const upstream = await fetch(url);
    if (!upstream.ok) {
        console.error("Failed to fetch file:", upstream.statusText);
        return res.status(500).send("Nepavyko gauti failo.");
    }

    res.setHeader(
        "Content-Type",
        upstream.headers.get("Content-Type") || contentType,
    );
    res.setHeader("Content-Disposition", contentDisposition);
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");

    const stream = Readable.fromWeb(upstream.body);
    stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) res.status(500).send("Error streaming file.");
        else res.destroy(err);
    });
    stream.pipe(res);
}
