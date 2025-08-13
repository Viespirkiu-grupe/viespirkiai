import express from "express";

const openGraphRouter = express.Router();

openGraphRouter.get("/openGraph", async (req, res) => {
    const { tipas, pavadinimas, aprasymas, id } = req.query;
    const safePavadinimas = (pavadinimas || "").replace(/<\/?[^>]+>/gi, "");

    const safeAprasymas = (aprasymas || "").replace(
        /<\/?(?!br\b|b\b|i\b|u\b)[^>]*>/gi,
        "",
    );

    res.render("openGraph", {
        tipas: tipas || "",
        pavadinimas: safePavadinimas || "",
        aprasymas: safeAprasymas || "",
        id: id || "",
    });
});

export default openGraphRouter;
