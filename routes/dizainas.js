import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const dizainasRouter = express.Router();

dizainasRouter.get("/dizainas", async (req, res) => {
    res.render("dizainas/dizainas", {
        customHead: config.customHead,
    });
});

dizainasRouter.get("/dizainas.png", async (req, res) => {
    await serveOpenGraphImage(
        res,
        "",
        "Dizainas",
        "",
        "viespirkiai.org/dizainas",
    );
});

export default dizainasRouter;
