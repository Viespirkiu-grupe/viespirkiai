import express from 'express';
import config from '../utils/config.js';

const duomenysRouter = express.Router();

duomenysRouter.get("/", async (req, res) => {
    res.render("duomenys", {
        customHead: config.customHead
    });
});

export default duomenysRouter;
