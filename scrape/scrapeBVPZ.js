import fs from "fs/promises";
import vm from "vm";

const BASE_URL =
    "https://pirkimai.eviesiejipirkimai.lt/ppo_startpage/subscribe/";

async function fetchJsObject(relativeUrl) {
    const url = new URL(relativeUrl, BASE_URL).href;
    console.log("Fetching:", url);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status}`);
    }
    const text = await res.text();

    try {
        // Wrap in parentheses so it's treated as an expression
        return vm.runInNewContext("(" + text + ")");
    } catch (e) {
        console.error("JS object parse error at", url);
        console.error(text.slice(0, 200) + "...");
        throw e;
    }
}

async function expandNode(node) {
    if (node.sourceType === "json/url" && node.source) {
        const data = await fetchJsObject(node.source);
        node.children = data.children || [];
    }

    if (Array.isArray(node.children)) {
        node.children = await Promise.all(node.children.map(expandNode));
    }

    return node;
}

async function main() {
    const root = await fetchJsObject("json/cpv/CPV_Codes.xml");
    let expanded = await expandNode(root);
    cleanSources(expanded);
    expanded = expanded.children;

    await fs.writeFile("cpv_full.json", JSON.stringify(expanded), "utf8");
    console.log("Saved cpv_full.json with full tree");
}

function cleanSources(node) {
    if (node && typeof node === "object") {
        delete node.source;
        delete node.sourceType;
        if (Array.isArray(node.children)) {
            node.children.forEach(cleanSources);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
