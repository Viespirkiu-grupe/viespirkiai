import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";
import { Marked } from "marked";
import markedFootnote from "marked-footnote";
import fs from "fs/promises";
import yaml from "js-yaml";

const marked = new Marked();
marked.use(
    markedFootnote({
        prefixId: "",
        description: "Išnašos",
        footnoteDivider: true,
        backRefLabel: "Atgal į ",
    }),
);

const vieslaiskiaiRouter = express.Router();

vieslaiskiaiRouter.get("/vieslaiskiai", async (req, res) => {
    const vieslaiskiaiRes = await postgres.query(
        "SELECT * FROM vieslaiskiai ORDER BY id DESC;",
    );

    const vieslaiskiai = vieslaiskiaiRes.rows;

    const vieslaiskiaiZiniasklaidojeRes = await postgres.query(
        `SELECT * FROM "vieslaiskiaiZiniasklaidoje" ORDER BY date DESC, id DESC;`,
    );

    const vieslaiskiaiZiniasklaidoje = vieslaiskiaiZiniasklaidojeRes.rows;

    res.render("vieslaiskiai", {
        customHead: config.customHead,
        vieslaiskiai,
        vieslaiskiaiZiniasklaidoje,
    });
});

vieslaiskiaiRouter.get("/vieslaiskiai/:id", async (req, res, next) => {
    // Render a file from public/vieslaiskiai/:id/markdown.md
    const id = req.params.id;

    // If id is not a number, return 404
    if (isNaN(id)) {
        next();
        return;
    }
    try {
        let markdownContent = await fs.readFile(
            `public/vieslaiskiai/${id}/markdown.md`,
            "utf-8",
        );

        // Extract frontmatter from markdownContent
        const frontmatterMatch = markdownContent.match(
            /^---\s*[\r\n]+([\s\S]+?)[\r\n]+---/,
        );

        let frontmatter = yaml.load(frontmatterMatch[1]);

        // Remove frontmatter from markdownContent
        markdownContent = markdownContent.replace(frontmatterMatch[0], "");

        const htmlContent = marked.parse(markdownContent);

        res.render("vieslaiskiai/vieslaiskis", {
            customHead: config.customHead,
            vieslaiskisContent: htmlContent,
            frontmatter,
            vieslaiskisId: id,
        });
    } catch (error) {
        console.error(error);
        res.status(404).send("Viešlaiškis nerastas");
    }
});

vieslaiskiaiRouter.get("/vieslaiskiai/vieslaiskiai.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Viešlaiškiai",
        "Viešpirkių iniciatyvos viešlaiškiai",
        "",
        "viespirkiai.org/vieslaiskiai",
    );
});

export default vieslaiskiaiRouter;
