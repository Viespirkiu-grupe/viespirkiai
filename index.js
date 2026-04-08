import config from "./utils/config.js";
import express from "express";
import cookieParser from "cookie-parser";
import { convertUnit } from "./utils/units.js"; // Modifies prototypes, keep
import { linksniuoti } from "./utils/linksniai.js"; // Modifies prototypes, keep
import ejs from "ejs";
import { log } from "./utils/log.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import fsPromises from "fs/promises";
import crypto from "crypto";
import htmlMinifyMiddleware from "./utils/minifyHtml.js";
import helmet from "helmet";
import { realpathSync } from "fs";
import { resolve } from "path";
import rateLimit from "express-rate-limit";
import {
    ensureSearchCollection,
    ensureJarCollection,
} from "./typesense/typesense.js";

import { highlightCode } from "./utils/highlightCode.js";
globalThis.highlightCode = highlightCode;

const app = express();
const PORT = config.port || 8000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minification
if (config.enableMinification !== false) {
    app.use(htmlMinifyMiddleware());
}

// Onion-Location header
if (config.onionAddress) {
    app.use((req, res, next) => {
        const onionBase = config.onionAddress;
        // encode the path and query
        const safeUrl = onionBase + encodeURI(req.originalUrl);

        res.setHeader("Onion-Location", safeUrl);
        next();
    });
}

// Security headers
app.use(
    helmet({
        contentSecurityPolicy: false, // disables CSP entirely
    }),
);

// Rate limit
if (!config.dev) {
    const globalLimiter = rateLimit({
        windowMs: 1 * 60 * 1000, // 1 min
        max: 600, // max requests per IP
        message: "Too many requests",
    });
    app.use(globalLimiter);
}

// Reverse proxy
app.set("trust proxy", config.proxyIp);
app.use((req, res, next) => {
    let ip = req.socket.remoteAddress; // default

    const xff = req.headers["x-forwarded-for"];
    if (xff) {
        const ips = xff.split(",").map((s) => s.trim());
        const lastHop = ips[ips.length - 1]; // IP of the last proxy
        if (lastHop === config.proxyIp) {
            // trust the first IP in X-Forwarded-For
            ip = ips[0];
        }
    }

    next();
});

// Favicon SVG
const faviconSVG = fs.readFileSync("./public/icons/icon.svg", "utf8");
app.locals.faviconSVG = faviconSVG;
app.locals.faviconSVGURLEncoded = encodeURIComponent(faviconSVG);

// CSS cache buster
const tailwindCssPath = path.join(__dirname, "public/dist/tailwind.css");
const computeCssMd5 = () =>
    crypto.createHash("md5").update(fs.readFileSync(tailwindCssPath)).digest("hex");

if (config.dev) {
    app.use((_req, res, next) => {
        res.locals.tailwindCssBuster = computeCssMd5();
        next();
    });
} else {
    app.locals.tailwindCssBuster = computeCssMd5();
}

// EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const templateCache = new Map();

app.use((req, res, next) => {
    res.renderCompiled = async (viewName, data = {}) => {
        if (config.dev) {
            return res.render(viewName, data);
        }

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

app.use(express.static(path.join(__dirname, "public"), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith("/dist/tailwind.css")) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
            res.setHeader("Cache-Control", "no-store");
        }
    },
}));

// Cookies
app.use(cookieParser());

app.use((req, res, next) => {
    res.locals.colorScheme = req.cookies?.colorScheme || "auto";
    res.locals.font = req.cookies?.font || "ubuntu";
    next();
});

// JSON
app.use(express.json({ limit: "25MB" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Auto-load all routes from /routes
const routesPath = path.join(__dirname, "routes");
const files = fs.readdirSync(routesPath).filter((file) => file.endsWith(".js"));

const loadStart = Date.now();
if (config.parallelRouteLoading !== false) {
    // Parallel: all imports fire at once, registered in original order afterwards
    const routeModules = await Promise.all(
        files.map(async (file) => {
            const start = Date.now();
            const mod = await import(`./routes/${file}`);
            log(`${file} loaded in ${Date.now() - start}ms`);
            return mod;
        })
    );
    for (let i = 0; i < files.length; i++) {
        app.use(routeModules[i].default);
    }
} else {
    // Sequential: one route at a time (useful for debugging startup order)
    for (const file of files) {
        const start = Date.now();
        const { default: router } = await import(`./routes/${file}`);
        app.use(router);
        log(`${file} loaded in ${Date.now() - start}ms`);
    }
}
log(`All ${files.length} routes loaded in ${Date.now() - loadStart}ms`);

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

const currentFile = fileURLToPath(import.meta.url);
const entryFile = realpathSync(resolve(process.argv[1]));

// Handle running as `node .` or `node dir/` (independently) vs being imported by server.js (cluster mode)
const isDirectRun =
    currentFile === entryFile ||
    currentFile === resolve(entryFile, "index.js") ||
    entryFile === resolve(currentFile, ".."); // dir match

if (isDirectRun) {
    await ensureSearchCollection();
    await ensureJarCollection();
    app.listen(PORT, () =>
        log(`Server running independently at http://localhost:${PORT}`),
    );
}

export default app;
