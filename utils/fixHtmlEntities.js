export function fixHtmlEntities(data) {
    if (typeof data === "string") {
        return data
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    } else if (Array.isArray(data)) {
        return data.map(fixHtmlEntities);
    } else if (data && typeof data === "object") {
        const fixedData = {};
        for (const key in data) {
            if (typeof key === "string") {
                fixedData[key] = fixHtmlEntities(data[key]);
            } else {
                fixedData[key] = data[key];
            }
        }
        return fixedData;
    }
    return data;
}