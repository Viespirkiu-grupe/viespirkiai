import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const bvpzRouter = express.Router();

bvpzRouter.get("/bvpz", async (req, res) => {
    res.render("bvpz", {
        customHead: config.customHead,
    });
});

bvpzRouter.get("/bvpz.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Viešpirkiai pilietinė iniciatyva",
        "BVPŽ kodų paieška",
        "",
        "viespirkiai.org/bvpz",
    );
});

export default bvpzRouter;
