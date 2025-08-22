import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { mysql } from "../mysql/mysql.js";

const vieslaiskiaiRouter = express.Router();

vieslaiskiaiRouter.get("/vieslaiskiai", async (req, res) => {
    const [vieslaiskiai] = await mysql.execute(
        "SELECT * FROM vieslaiskiai ORDER BY id DESC;",
    );

    res.render("vieslaiskiai", {
        customHead: config.customHead,
        vieslaiskiai,
    });
});

vieslaiskiaiRouter.get("/vieslaiskiai/vieslaiskiai.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Viešlaiškiai",
        "Viešpirkių iniciatyvos viešlaiškiai",
        "",
        "viespirkiai.top/vieslaiskiai",
    );
});

export default vieslaiskiaiRouter;
