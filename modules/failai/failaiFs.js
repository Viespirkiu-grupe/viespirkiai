import { createSidecarStore } from "../../utils/sidecarStore.js";

/*
Sujungtas failo turinio JSON — { tekstas, metaduomenys, iban, jarKodai, links,
emails, domains, telefonai }. Pakeičia senuosius atskirus `tekstasFs` ir
`metaduomenysFs` sidecar'us.

Ypatybė: raktas čia yra paties turinio hash'as (ne failo md5), todėl serializuoti
reikia lygiai vieną kartą — kitaip hash'as ir įrašyti baitai gali nesutapti
(žr. `prepareFailaiFs`). Formatas tas pats md5 hex, tad API parametras — `md5`,
kaip ir visų kitų sidecar'ų.
*/
const store = createSidecarStore({
    sidecar: "failaiInfo",
    label: "failo turinio",
});

/**
 * Sujungto failo turinio objekto hash (raktas FS saugykloje).
 * @param {Object} failas
 * @returns {string} md5 hex
 */
export const hashFailai = store.hash;

/**
 * Serializuoja vieną kartą, kad hash'as ir įrašomi baitai sutaptų tiksliai.
 * @param {Object} failas
 * @returns {{ hash: string, json: string }}
 */
export function prepareFailaiFs(failas) {
    const { hash, contents } = store.prepare(failas);
    return { hash, json: contents };
}

/** Įrašo turinį, jau serializuotą `prepareFailaiFs()`. */
export const savePreparedFailaiFs = store.saveRaw;

/** @param {string} hash @returns {Promise<Object|null>} */
export const readFailaiFs = store.read;
