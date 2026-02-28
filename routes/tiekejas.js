import express from "express";

const tiekejasRouter = express.Router();

tiekejasRouter.get("/tiekejas/:kodas", async (req, res) => {
    const { kodas } = req.params;
    const safeKodas = encodeURIComponent(kodas);
    res.redirect(`/?tiekejoKodas=${safeKodas}`);
});

export default tiekejasRouter;
