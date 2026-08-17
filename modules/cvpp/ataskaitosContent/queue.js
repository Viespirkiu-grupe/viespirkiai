import { postgres } from "../../../postgres/postgres.js";
import { scrapeAtaskaitosContent } from "./fetch.js";
import { KLAIDOS_BUSENA, NUSKAITYMO_VERSIJA } from "./primitives.js";

async function setStatus(ataskaitosNumeris, status) {
    await postgres.query(
        `UPDATE public."cvppAtaskaitos" SET nuskaitymas = $1 WHERE "ataskaitosNumeris" = $2`,
        [status, ataskaitosNumeris],
    );
}

// Paima vieną dar nesuparsintą (ar senesnės versijos / null) cvppAtaskaitos eilutę,
// suparsina ir įrašo "turinys" (jsonb) + "turinysHtml", nuskaitymas = versija.
// Klaidas pažymi nuskaitymas = -1. Grąžina false, kai eilučių nebeliko.
export async function scrapeVienaAtaskaita() {
    const { rows } = await postgres.query(
        `SELECT "ataskaitosNumeris", "formTypeId"
         FROM public."cvppAtaskaitos"
         WHERE (nuskaitymas < $1 AND nuskaitymas >= 0) OR nuskaitymas IS NULL
         LIMIT 1`,
        [NUSKAITYMO_VERSIJA],
    );

    if (rows.length < 1) return false;

    const { ataskaitosNumeris, formTypeId } = rows[0];
    try {
        const res = await scrapeAtaskaitosContent(ataskaitosNumeris, formTypeId);
        if (!res) throw new Error("nėra #notice");
        await postgres.query(
            `UPDATE public."cvppAtaskaitos"
             SET "turinys" = $1, "turinysHtml" = $2, "pirkimoObjektoRusis" = $3, nuskaitymas = $4
             WHERE "ataskaitosNumeris" = $5`,
            [
                res.turinys ? JSON.stringify(res.turinys) : null,
                res.turinysHtml,
                res.turinys?.pirkimoObjektoRusis ?? null,
                NUSKAITYMO_VERSIJA,
                ataskaitosNumeris,
            ],
        );
        console.log(`[CVPP ataskaita] ${ataskaitosNumeris}: suparsinta`);
        return true;
    } catch (err) {
        console.error(`[CVPP ataskaita] ${ataskaitosNumeris}: klaida - ${err.message}`);
        try {
            await setStatus(ataskaitosNumeris, KLAIDOS_BUSENA);
        } catch (updateError) {
            console.error(
                `[CVPP ataskaita] ${ataskaitosNumeris}: nepavyko pažymėti klaidos - ${updateError.message}`,
            );
        }
        return true;
    }
}

