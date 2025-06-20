import express from 'express';

const tiekejasRouter = express.Router();

tiekejasRouter.get("/:kodas", async (req, res) => {
	const { kodas } = req.params;
	res.redirect(`/?tiekejoKodas=${kodas}`);
});

export default tiekejasRouter;
