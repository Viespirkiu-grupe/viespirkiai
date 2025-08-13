import express from "express";

const korespondencijaRouter = express.Router();

korespondencijaRouter.get("/korespondencija", async (req, res) => {
    res.redirect("https://github.com/Viespirkiu-grupe/korespondencija/issues");
});

export default korespondencijaRouter;
