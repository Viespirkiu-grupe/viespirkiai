import express from 'express';
import config from '../utils/config.js';

const analitikaRouter = express.Router();

analitikaRouter.get("/", async (req, res) => {
    res.redirect(config.analitikaUrl);
});

export default analitikaRouter;
