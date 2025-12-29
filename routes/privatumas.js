import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const privatumasRouter = express.Router();

privatumasRouter.get("/privatumas", async (req, res) => {
    res.render("privatumas", {
        customHead: config.customHead,
    });
});

privatumasRouter.get("/privatumas.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "",
        "Privatumo politika",
        "Viešpirkiai puslapio privatumo politika",
        "viespirkiai.org/privatumas",
    );
});

export default privatumasRouter;
