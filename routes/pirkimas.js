import express from "express";

const pirkimasRouter = express.Router();

pirkimasRouter.get("/pirkimas/:id", async (req, res, next) => {
    const id = encodeURIComponent(req.params.id);
    res.redirect(`/sutartis/${id}`);
});

export default pirkimasRouter;
