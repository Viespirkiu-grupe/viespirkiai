import express from "express";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

const openGraphRouter = express.Router();

openGraphRouter.get("/openGraph", async (req, res) => {
    const { tipas, pavadinimas, aprasymas, id } = req.query;

    const safePavadinimas = DOMPurify.sanitize(pavadinimas || "");
    const safeAprasymas = DOMPurify.sanitize(aprasymas || "", {
        ALLOWED_TAGS: ["b", "i", "u", "br"],
    });

    res.render("openGraph", {
        tipas: tipas || "",
        pavadinimas: safePavadinimas,
        aprasymas: safeAprasymas,
        id: id || "",
    });
});

export default openGraphRouter;
