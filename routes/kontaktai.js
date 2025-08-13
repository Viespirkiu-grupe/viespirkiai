import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const kontaktaiRouter = express.Router();

kontaktaiRouter.get("/kontaktai", async (req, res) => {
    res.render("kontaktai", {
        customHead: config.customHead,
    });
});

kontaktaiRouter.get("/kontaktai.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Viešpirkiai pilietinė iniciatyva",
        "Kontaktai",
        "",
        "viespirkiai.top/kontaktai",
    );
});

export default kontaktaiRouter;
