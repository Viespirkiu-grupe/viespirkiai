import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const kontaktaiRouter = express.Router();

kontaktaiRouter.get("/kontaktai", async (req, res) => {
    res.render("kontaktai", {
        customHead: config.customHead,
        req,
    });
});

kontaktaiRouter.get("/kontaktai.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Viešpirkiai pilietinė iniciatyva",
        "Kontaktai",
        "",
        "viespirkiai.org/kontaktai",
    );
});

export default kontaktaiRouter;
