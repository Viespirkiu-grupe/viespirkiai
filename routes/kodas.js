import express from 'express';
import config from '../utils/config.js';

const kodasRouter = express.Router();

kodasRouter.get("/", async (req, res) => {
    res.redirect("https://github.com/Viespirkiu-grupe/viespirkiai");
});

export default kodasRouter;
