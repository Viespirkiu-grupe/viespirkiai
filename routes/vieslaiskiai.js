import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";

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
