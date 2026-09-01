import { postgres } from "../../postgres/postgres.js";

/*
AI modelių parinkimas iš DB.

`ai."modeliuVariantai"` laiko konkrečias modelių konfigūracijas (platforma,
modelis, reasoning effort, limitai), o `ai."paskirtys"` pasako, KURIS
variantas kuriam darbui naudojamas ir ar tas darbas išvis įjungtas. Taip modelio keitimas ar
eilės stabdymas yra `UPDATE`, o ne kodo pakeitimas su perkrovimu.

Aprašymų lentelėse PK yra (objektas, modelioVariantasId), tad pakeitus paskirties
variantą tie patys objektai bus aprašomi iš naujo nauju modeliu — seni aprašymai
lieka vietoje ir niekas neperrašoma.
*/

/** Žinomi `ai."paskirtys".paskirtis` raktai. */
export const PASKIRTYS = {
    VIESUJU_PIRKIMU_APRASYMAS: "viesiejiPirkimaiAprasymas",
    SUTARCIU_APRASYMAS: "sutarciuAprasymas",
};

/**
 * @param {number|string} id - `ai."modeliuVariantai".id`
 * @returns {Promise<Record<string, any>>}
 */
export async function getVariant(id) {
    const { rows } = await postgres.query(
        `SELECT * FROM "ai"."modeliuVariantai" WHERE "id" = $1`,
        [id],
    );
    if (!rows[0]) throw new Error(`ai."modeliuVariantai".id=${id} nerastas.`);
    return rows[0];
}

/**
 * Paskirties modelis ir jos įjungimo vėliava.
 *
 * Trūkstama eilutė yra klaida, o ne „išjungta": tyliai nedirbanti eilė be
 * pėdsakų būtų blogiau nei krentantis darbas su aiškiu pranešimu.
 *
 * @param {string} paskirtis - `PASKIRTYS` reikšmė
 * @returns {Promise<{paskirtis: string, aktyvus: boolean, variant: Record<string, any>}>}
 */
export async function getPaskirtis(paskirtis) {
    const { rows } = await postgres.query(
        `SELECT p."aktyvus", v.*
         FROM "ai"."paskirtys" p
         JOIN "ai"."modeliuVariantai" v ON v.id = p."modelioVariantasId"
         WHERE p."paskirtis" = $1`,
        [paskirtis],
    );
    if (!rows[0]) {
        throw new Error(
            `ai."paskirtys" eilutė "${paskirtis}" nerasta — nurodykite, kuris`
            + ' ai."modeliuVariantai" variantas naudojamas šiam darbui.',
        );
    }
    const { aktyvus, ...variant } = rows[0];
    return { paskirtis, aktyvus, variant };
}

/** `ai."modeliuVariantai"` eilutė → OpenRouter modelio pavadinimas. */
export function apiModel(variant) {
    if (variant.platforma !== "openrouter") {
        throw new Error(`Kol kas palaikoma tik openrouter platforma, gauta: ${variant.platforma}`);
    }
    return variant.modelis.includes("/")
        ? variant.modelis
        : `${variant.tiekejas}/${variant.modelis}`;
}
