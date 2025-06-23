export function fixHtmlEntities(data) {
    if (typeof data === "string") {
        return data.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#160;|&nbsp;|&euro;|\\"/g, match => {
            const entities = {
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": '"',
            "&#39;": "'",
            "&#160;": " ",
            "&nbsp;": " ",
            "&euro;": "€",
            '\\"': '"'
            };
            return entities[match];
        });
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