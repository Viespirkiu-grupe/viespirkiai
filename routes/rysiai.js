import express from 'express';
import { log } from '../utils/log.js';
import { expandOrg, expandPerson, expandProcurement, expandContract, expandSutartis, expandPirkimas, isBlockedOrg } from '../modules/rysiai/expand.js';
import config from '../utils/config.js';

const rysiaiRouter = express.Router();

// ── Static page routes (must precede wildcard segments) ───────────────────────

rysiaiRouter.get('/rysiai', (req, res) => {
    res.renderCompiled('rysiai/landing', { req, customHead: config.customHead || '' });
});

rysiaiRouter.get('/rysiai/', (req, res) => res.redirect('/rysiai'));

rysiaiRouter.get('/rysiai/asmuo/:jarKodas', (req, res, next) => {
    const { jarKodas } = req.params;
    if (!/^\d+$/.test(jarKodas)) return next();
    res.renderCompiled('rysiai/index', {
        req,
        entityType: 'asmuo',
        entityId: jarKodas,
        customHead: config.customHead || '',
    });
});

// ── JSON API endpoints ────────────────────────────────────────────────────────

rysiaiRouter.get('/rysiai/expand/:jarKodas', async (req, res) => {
    const { jarKodas } = req.params;
    if (!jarKodas || !/^\d+$/.test(jarKodas)) {
        return res.status(400).json({ error: 'Neteisingas jarKodas' });
    }
    if (isBlockedOrg(jarKodas)) {
        return res.json({ nodes: [], edges: [] });
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

rysiaiRouter.get('/rysiai/expand-sutartis/:sutartiesUnikalusId', async (req, res) => {
    const { sutartiesUnikalusId } = req.params;
    if (!sutartiesUnikalusId || !/^\d+$/.test(sutartiesUnikalusId)) {
        return res.status(400).json({ error: 'Neteisingas sutartiesUnikalusId' });
    }
    try {
        const data = await expandSutartis(sutartiesUnikalusId);
        res.json(data);
    } catch (err) {
        log(`expandSutartis klaida (${sutartiesUnikalusId}): ${err.message}`);
        res.status(500).json({ error: 'Vidinė klaida' });
    }
});

rysiaiRouter.get('/rysiai/expand-pirkimas/:pirkimoId', async (req, res) => {
    const { pirkimoId } = req.params;
    if (!pirkimoId || !/^\d+$/.test(pirkimoId)) {
        return res.status(400).json({ error: 'Neteisingas pirkimoId' });
    }
    try {
        const data = await expandPirkimas(pirkimoId);
        res.json(data);
    } catch (err) {
        log(`expandPirkimas klaida (${pirkimoId}): ${err.message}`);
        res.status(500).json({ error: 'Vidinė klaida' });
    }
});

export default rysiaiRouter;
