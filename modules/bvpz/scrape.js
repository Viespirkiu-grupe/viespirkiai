import fs from "fs/promises";
import vm from "vm";

const BASE_URL =
    "https://pirkimai.eviesiejipirkimai.lt/ppo_startpage/subscribe/";

/**
 * Fetch a JS object from a relative URL.
 * The URL is resolved against BASE_URL.
 * The response is expected to be a JavaScript object literal.
 * This function uses a VM to safely evaluate the object literal.
 * @param {string} relativeUrl
 * @returns {Promise<any>}
 */
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

/**
 * Recursively expand nodes with sourceType "json/url"
 * by fetching their source and replacing children.
 * @param {object} node
 * @returns {Promise<object>}
 */
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

/**
 * Recursively remove source and sourceType properties from nodes.
 * @param {object} node
 */
function cleanSources(node) {
    if (node && typeof node === "object") {
        delete node.source;
        delete node.sourceType;
        if (Array.isArray(node.children)) {
            node.children.forEach(cleanSources);
        }
    }
}

/**
 * Main function to fetch, expand, clean, and save the CPV codes tree.
 */
async function main() {
    const root = await fetchJsObject("json/cpv/CPV_Codes.xml");
    let expanded = await expandNode(root);
    cleanSources(expanded);
    expanded = expanded.children;

    await fs.writeFile(
        "../../public/dist/cpv.json",
        JSON.stringify(expanded),
        "utf8",
    );
    console.log("Saved cpv.json with full tree");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
