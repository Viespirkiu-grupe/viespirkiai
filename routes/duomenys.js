import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const duomenysRouter = express.Router();

duomenysRouter.get("/duomenys", async (req, res) => {
    res.render("duomenys", {
        customHead: config.customHead,
    });
});

duomenysRouter.get("/duomenys.png", async (req, res) => {
    await serveOpenGraphImage(
        res,
        "Viešai prieinami",
        "Duomenys",
        "Čia galite pasiekti mūsų duomenų eksportus bei sužinoti apie naudojamus šaltinius",
        "viespirkiai.org/duomenys",
    );
});

export default duomenysRouter;
