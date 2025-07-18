import express from 'express';
import config from '../utils/config.js';

const kontaktaiRouter = express.Router();

kontaktaiRouter.get("/", async (req, res) => {
    res.render("kontaktai", {
        customHead: config.customHead,
    });
});

export default kontaktaiRouter;
