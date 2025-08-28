import express from "express";
import config from "../utils/config.js";
import { mysql } from "../mysql/mysql.js";
import { postgres } from "../postgres/postgres.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const duomenysRouter = express.Router();

duomenysRouter.get("/duomenys", async (req, res) => {
    const query = `SELECT id, pavadinimas, "dydisMB", data FROM eksportai ORDER BY data DESC`;
    const { rows: eksportai } = await postgres.query(query);

    res.render("duomenys", {
        customHead: config.customHead,
        eksportai,
    });
});

duomenysRouter.get("/duomenys.png", async (req, res) => {
    await serveOpenGraphImage(
        res,
        "Viešai prieinami",
        "Duomenys",
        "Čia galite pasiekti mūsų duomenų eksportus bei sužinoti apie naudojamus šaltinius",
        "viespirkiai.top/duomenys",
    );
});

export default duomenysRouter;
