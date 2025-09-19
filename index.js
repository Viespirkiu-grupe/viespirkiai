import config from "./utils/config.js";
import express from "express";
import cookieParser from "cookie-parser";
import { convertUnit } from "./utils/units.js";
import { linksniuoti } from "./utils/linksniai.js";
import { log } from "./utils/log.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();
const PORT = config.port || 8000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Static routes
app.use(express.static(path.join(__dirname, "public")));

// Cookies
app.use(cookieParser());

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
    console.log(req.path);
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
await ensureSearchCollection();
await ensureJarCollection();

app.listen(PORT, () =>
    console.log(`Server running at http://localhost:${PORT}`),
);
