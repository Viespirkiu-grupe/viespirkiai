import express from 'express';
import { log } from '../utils/log.js';
import { expandOrg, expandPerson, expandProcurement, expandContract } from '../modules/rysiai/expand.js';
import config from '../utils/config.js';

const rysiaiRouter = express.Router();

rysiaiRouter.get('/rysiai/expand/:jarKodas', async (req, res) => {
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

rysiaiRouter.get('/rysiai/expand-person', async (req, res) => {
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

rysiaiRouter.get('/rysiai/expand-procurement/:id', async (req, res) => {
    const { id } = req.params;
    if (!id || !/^\d+$/.test(id)) {
        return res.status(400).json({ error: 'Neteisingas pirkimoId' });
    }
    try {
        const data = await expandProcurement(id);
        res.json(data);
    } catch (err) {
        log(`expandProcurement klaida (${id}): ${err.message}`);
        res.status(500).json({ error: 'Vidinė klaida' });
    }
});

rysiaiRouter.get('/rysiai/expand-contract/:pirkimoNumeris', async (req, res) => {
    const { pirkimoNumeris } = req.params;
    if (!pirkimoNumeris || !/^\d+$/.test(pirkimoNumeris)) {
        return res.status(400).json({ error: 'Neteisingas pirkimoNumeris' });
    }
    try {
        const data = await expandContract(pirkimoNumeris);
        res.json(data);
    } catch (err) {
        log(`expandContract klaida (${pirkimoNumeris}): ${err.message}`);
        res.status(500).json({ error: 'Vidinė klaida' });
    }
});

rysiaiRouter.get('/rysiai/:jarKodas', async (req, res, next) => {
    const { jarKodas } = req.params;
    if (!jarKodas || !/^\d+$/.test(jarKodas)) return next();
    res.renderCompiled('rysiai/index', {
        req,
        jarKodas,
        customHead: config.customHead || '',
    });
});

export default rysiaiRouter;
