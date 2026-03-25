import express from "express";

const openGraphRouter = express.Router();

let DOMPurify = null;

openGraphRouter.get("/openGraph", async (req, res) => {
    if (!DOMPurify) {
        const { default: createDOMPurify } = await import("dompurify");
        const { JSDOM } = await import("jsdom");
        DOMPurify = createDOMPurify(new JSDOM("").window);
    }

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
