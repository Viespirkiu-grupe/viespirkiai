import express from "express";
import config from "../utils/config.js";

const analitikaRouter = express.Router();

analitikaRouter.get("/analitika", async (req, res) => {
    res.redirect(config.analitikaUrl);
});

export default analitikaRouter;
