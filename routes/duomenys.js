import express from 'express';
import config from '../utils/config.js';
import { mysql } from '../mysql/mysql.js';

const duomenysRouter = express.Router();

duomenysRouter.get("/", async (req, res) => {
    const query = "SELECT id, pavadinimas, dydisMB, data FROM eksportai ORDER BY data DESC";
    const [eksportai] = await mysql.query(query);

    res.render("duomenys", {
        customHead: config.customHead,
        eksportai
    });
});

export default duomenysRouter;
