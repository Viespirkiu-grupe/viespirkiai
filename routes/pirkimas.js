import express from "express";

const pirkimasRouter = express.Router();

pirkimasRouter.get("/pirkimas/:id", async (req, res, next) => {
    // Redirect to /sutartis/:id
    const id = req.params.id;
    res.redirect(`/sutartis/${id}`);
});

export default pirkimasRouter;
