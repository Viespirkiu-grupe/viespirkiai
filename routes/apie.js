import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const apieRouter = express.Router();

apieRouter.get("/apie", async (req, res) => {
    res.render("apie", {
        customHead: config.customHead,
    });
});

apieRouter.get("/apie.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Viešpirkiai pilietinė iniciatyva",
        "Apie mus",
        "",
        "viespirkiai.org/apie",
    );
});

export default apieRouter;
