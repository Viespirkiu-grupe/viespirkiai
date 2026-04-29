import express from 'express';
import { log } from '../utils/log.js';
import { expandOrg, expandPerson } from '../modules/voratinklis/expand.js';
import config from '../utils/config.js';

const voratinklisRouter = express.Router();

voratinklisRouter.get('/voratinklis/expand/:jarKodas', async (req, res) => {
    const { jarKodas } = req.params;
    if (!jarKodas || !/^\d+$/.test(jarKodas)) {
        return res.status(400).json({ error: 'Neteisingas jarKodas' });
    }
    try {
        const data = await expandOrg(jarKodas);
        res.json(data);
    } catch (err) {
        log(`expandOrg klaida (${jarKodas}): ${err.message}`);
        res.status(500).json({ error: 'Vidinė klaida' });
    }
});

voratinklisRouter.get('/voratinklis/expand-person', async (req, res) => {
    const { vardas } = req.query;
    if (!vardas || !vardas.trim()) {
        return res.status(400).json({ error: 'Trūksta parametro: vardas' });
    }
    try {
        const data = await expandPerson(vardas.trim());
        res.json(data);
    } catch (err) {
        log(`expandPerson klaida (${vardas}): ${err.message}`);
        res.status(500).json({ error: 'Vidinė klaida' });
    }
});

voratinklisRouter.get('/voratinklis/:jarKodas', async (req, res, next) => {
    const { jarKodas } = req.params;
    if (!jarKodas || !/^\d+$/.test(jarKodas)) return next();
    res.renderCompiled('voratinklis/index', {
        req,
        jarKodas,
        customHead: config.customHead || '',
    });
});

export default voratinklisRouter;
