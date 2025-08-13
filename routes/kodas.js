import express from "express";

const kodasRouter = express.Router();

kodasRouter.get("/kodas", async (req, res) => {
    res.redirect("https://github.com/Viespirkiu-grupe/viespirkiai");
});

export default kodasRouter;
