import config from "./utils/config.js";
import express from "express";
import cookieParser from "cookie-parser";
import { convertUnit } from "./utils/units.js"; // Modifies protorypes, keep
import { linksniuoti } from "./utils/linksniai.js"; // Modifies protorypes, keep
import { log } from "./utils/log.js";
import ejs from "ejs";
import { log } from "./utils/log.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import fsPromises from "fs/promises";
import htmlMinifyMiddleware from "./utils/minifyHtml.js";

const app = express();
const PORT = config.port || 8000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("trust proxy", 1);

if (config.enableMinification !== false) {
    app.use(htmlMinifyMiddleware());
}

// Onion-location header
app.use((req, res, next) => {
    const onionBase =
        "http://viespirk6fj2pukym5gv5pqsuzc77jaudkbddxvqjjoetph337dhyrqd.onion";
    res.setHeader("Onion-Location", onionBase + req.originalUrl);

    next();
});

// Favicon SVG
const faviconSVG = fs.readFileSync("./public/icons/icon.svg", "utf8");
app.locals.faviconSVG = faviconSVG;
app.locals.faviconSVGURLEncoded = encodeURIComponent(faviconSVG);

// EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const templateCache = new Map();

app.use((req, res, next) => {
    res.renderCompiled = async (viewName, data = {}) => {
        const viewsDir = req.app.get("views");
        const engine = req.app.get("view engine");
        const filePath = path.join(viewsDir, `${viewName}.${engine}`);

        let templateFn = templateCache.get(filePath);

        if (!templateFn) {
            const templateStr = await fsPromises.readFile(filePath, "utf-8");
            templateFn = ejs.compile(templateStr, {
                filename: filePath,
                cache: true,
            });
            templateCache.set(filePath, templateFn);
        }

        const mergedData = { ...req.app.locals, ...res.locals, ...data };

        const html = templateFn(mergedData);
        res.send(html);
    };

    next();
});

// Static routes
app.use(
    "/fontai",
    express.static(path.join(__dirname, "public/fontai"), {
        maxAge: "1y",
        immutable: true,
    }),
);

app.use(express.static(path.join(__dirname, "public")));

// Cookies
app.use(cookieParser());

// JSON
app.use(express.json({ limit: "100MB" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// Auto-load all routes from /routes (in parallel)
const routesPath = path.join(__dirname, "routes");
const files = fs.readdirSync(routesPath).filter((file) => file.endsWith(".js"));

for (const file of files) {
    const start = Date.now();

    const { default: router } = await import(`./routes/${file}`);
    app.use(router);

    const duration = Date.now() - start;
    log(`${file} loaded in ${duration}ms`);
}

// 404
app.use((req, res, next) => {
    res.status(404).render("404", {
        customHead: config.customHead,
    });
});

// 500
app.use((err, req, res, next) => {
    log(`Error 500: ${req.path}`);
    console.error(err);
    res.status(500).render("500", {
        customHead: config.customHead,
    });
});

// Search database
import {
    ensureSearchCollection,
    ensureJarCollection,
} from "./typesense/typesense.js";

const isMain = process.env.RUN_DIRECTLY === "true";

// Only listen if this file is run directly
if (import.meta.url === `file://${process.argv[1]}` || isMain) {
    await ensureSearchCollection();
    await ensureJarCollection();

    app.listen(PORT, () =>
        log(`Server running independently at http://localhost:${PORT}`),
    );
}

export default app;
