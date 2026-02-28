import express from "express";

const pirkejasRouter = express.Router();

pirkejasRouter.get("/pirkejas/:kodas", async (req, res) => {
    const { kodas } = req.params;
    const safeKodas = encodeURIComponent(kodas);
    res.redirect(`/?perkanciosiosOrganizacijosKodas=${safeKodas}`);
});

export default pirkejasRouter;
