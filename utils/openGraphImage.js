import fs from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

// Astro build'e šis failas atsiduria dist/server/chunks/, tad kelio nuo
// import.meta.url skaičiuoti negalima — ir dev, ir runtime cwd yra repo/app
// šaknis, kurioje Docker image'e primontuojamas src/assets katalogas.
const rootDir = process.cwd();
const fontaiDir = path.join(rootDir, "src", "assets", "fontai");

// Spalvos atitinka design-system stone paletę (šviesi tema)
const COLORS = {
    white: "#fafaf9", // stone-50
    black: "#0c0a09", // stone-950
    darkGray: "#57534e", // stone-600
    gray: "#78716c", // stone-500
};

const fonts = [
    {
        name: "Ubuntu",
        data: fs.readFileSync(path.join(fontaiDir, "Ubuntu-Regular.ttf")),
        weight: 400,
        style: "normal",
    },
    {
        name: "Ubuntu",
        data: fs.readFileSync(path.join(fontaiDir, "Ubuntu-Medium.ttf")),
        weight: 700,
        style: "normal",
    },
    {
        name: "Ubuntu Mono",
        data: fs.readFileSync(path.join(fontaiDir, "UbuntuMono-Regular.ttf")),
        weight: 400,
        style: "normal",
    },
];

const logoSvg = fs
    .readFileSync(
        path.join(rootDir, "src", "assets", "branding", "viespirkiaiLogo.svg"),
        "utf-8",
    )
    .replaceAll("currentColor", COLORS.black)
    .replace(/style="[^"]*"/, "");
const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;

function stripTags(text) {
    return decodeEntities(String(text ?? "").replace(/<[^>]*>/g, ""));
}

function decodeEntities(text) {
    return text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
}

/**
 * Paverčia aprašymo HTML (leidžiami b/i/u/br) į satori span'us.
 */
function parseDescription(html) {
    const parts = String(html ?? "").split(/(<\/?(?:b|i|u)>|<br\s*\/?>)/i);
    const lines = [[]];
    let bold = 0;
    let underline = 0;
    for (const part of parts) {
        const tag = part.match(/^<(\/?)(br|b|i|u)/i);
        if (tag) {
            const closing = tag[1] === "/";
            const name = tag[2].toLowerCase();
            if (name === "br") {
                lines.push([]);
            } else if (name === "b") {
                bold += closing ? -1 : 1;
            } else if (name === "u") {
                underline += closing ? -1 : 1;
            }
            // i ignoruojamas: italic šrifto nėra, satori jo nesintetina
        } else if (part) {
            lines[lines.length - 1].push({
                type: "span",
                props: {
                    style: {
                        fontWeight: bold > 0 ? 700 : 400,
                        textDecoration: underline > 0 ? "underline" : "none",
                        whiteSpace: "pre-wrap",
                    },
                    children: decodeEntities(stripTags(part)),
                },
            });
        }
    }
    return lines.map((spans) => ({
        type: "div",
        props: {
            style: { display: "flex", flexWrap: "wrap" },
            children: spans,
        },
    }));
}

/**
 * Generates an Open Graph image with satori + resvg (no browser).
 * @param {string} tipas - Type
 * @param {string} pavadinimas - Title
 * @param {string} aprasymas - Description (may contain b/i/u/br tags)
 * @param {string} id - ID
 * @returns {Promise<Buffer>} - PNG image buffer
 */
export async function getOpenGraphImage(tipas, pavadinimas, aprasymas, id) {
    const element = {
        type: "div",
        props: {
            style: {
                width: 1200,
                height: 630,
                background: COLORS.white,
                padding: 64,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                fontFamily: "Ubuntu",
            },
            children: [
                {
                    type: "div",
                    props: {
                        style: { display: "flex", flexDirection: "column" },
                        children: [
                            {
                                type: "div",
                                props: {
                                    style: {
                                        fontSize: 28,
                                        color: COLORS.gray,
                                        marginBottom: 16,
                                    },
                                    children: stripTags(tipas),
                                },
                            },
                            {
                                type: "div",
                                props: {
                                    style: {
                                        fontSize: 64,
                                        fontWeight: 700,
                                        lineHeight: 1.1,
                                        color: COLORS.black,
                                        marginBottom: 24,
                                        display: "block",
                                        lineClamp: 3,
                                    },
                                    children: stripTags(pavadinimas),
                                },
                            },
                            {
                                type: "div",
                                props: {
                                    style: {
                                        fontSize: 32,
                                        lineHeight: 1.4,
                                        color: COLORS.darkGray,
                                        display: "flex",
                                        flexDirection: "column",
                                    },
                                    children: parseDescription(aprasymas),
                                },
                            },
                        ],
                    },
                },
                {
                    type: "div",
                    props: {
                        style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        },
                        children: [
                            {
                                type: "div",
                                props: {
                                    style: {
                                        fontSize: 28,
                                        fontFamily: "Ubuntu Mono",
                                        color: COLORS.gray,
                                    },
                                    children: stripTags(id),
                                },
                            },
                            {
                                type: "img",
                                props: {
                                    src: logoDataUri,
                                    width: 225,
                                    height: 49.4,
                                },
                            },
                        ],
                    },
                },
            ],
        },
    };

    const svg = await satori(element, { width: 1200, height: 630, fonts });
    const resvg = new Resvg(svg, {
        fitTo: { mode: "width", value: 1200 },
    });
    return resvg.render().asPng();
}

export async function serveOpenGraphImage(
    res,
    title,
    subtitle,
    description,
    code,
) {
    const pngBuffer = await getOpenGraphImage(
        title,
        subtitle,
        description,
        code,
    );

    res.set("Cache-Control", "public, max-age=7200, s-maxage=7200");
    res.setHeader("Content-Type", "image/png");
    res.send(pngBuffer);
}
