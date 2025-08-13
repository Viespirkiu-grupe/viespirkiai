import express from "express";

const pirkejasRouter = express.Router();

pirkejasRouter.get("/pirkejas/:kodas", async (req, res) => {
    const { kodas } = req.params;
    res.redirect(`/?perkanciosiosOrganizacijosKodas=${kodas}`);
});

export default pirkejasRouter;
