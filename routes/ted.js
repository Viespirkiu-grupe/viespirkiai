import express from "express";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import config from "../utils/config.js";
import { postgres } from "../postgres/postgres.js";
import { buildTedNoticeViewModel } from "../modules/ted/viewer.js";

const tedRouter = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const tedSamplesDir = join(__dirname, "../modules/ted/samples");

function getSampleFiles() {
    return readdirSync(tedSamplesDir)
        .filter((fileName) => fileName.endsWith(".xml"))
        .sort((left, right) => left.localeCompare(right, "lt"));
}

const sampleNames = new Set(getSampleFiles().map((fileName) => fileName.replace(/\.xml$/, "")));

function renderSampleNotice(req, res, next) {
    const sampleName = req.params.sampleName;
    if (!sampleNames.has(sampleName)) {
        return next();
    }
    const fileName = `${sampleName}.xml`;
    const samplePath = join(tedSamplesDir, fileName);

    try {
        const sampleXml = readFileSync(samplePath, "utf-8");
        const tedView = buildTedNoticeViewModel(sampleXml);

        return res.render("ted/notice.ejs", {
            customHead: config.customHead,
            CONFIG: config,
            colorScheme: res.locals?.colorScheme || "auto",
            req,
            ...tedView,
            noticeId: sampleName,
        });
    } catch {
        return next();
    }
}
tedRouter.get("/ted/:sampleName", renderSampleNotice);

async function renderTedNotice(req, res, next) {
    // Id has to look like year-number, e.g. 2023-1234...
    const { id } = req.params;

    if (!/^\d+-\d{4}$/.test(id)) {
        return next();
    }

    let tedRes = await postgres.query(
        `SELECT * FROM "tedNotices" WHERE "tedNoticeNumber" = $1;`,
        [id]
    );
    
    if (tedRes.rowCount === 0) {
        return next();
    }   

    let notice = tedRes.rows[0];
    if(!notice.scrapeStatus || !notice.turinys || notice.scrapeStatus < 1){
        return next();
    }

    const isJson = req.originalUrl.endsWith(".json");
    if (isJson) {
        res.json(tedRes.rows[0]);
    } else {
        const tedView = buildTedNoticeViewModel(notice.turinys);
        res.render("ted/notice.ejs", {
            customHead: config.customHead,
            CONFIG: config,
            colorScheme: res.locals?.colorScheme || "auto",
            req,
            ...tedView,
        });
    }
}

tedRouter.get("/ted/:id", renderTedNotice);
tedRouter.get("/ted/:id.json", renderTedNotice);

export default tedRouter;
