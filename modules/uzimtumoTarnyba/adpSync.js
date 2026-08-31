import { paruostiEilute, SALTINIO_LAUKAI } from "./darboVietosEilute.js";
import { irasytiDarboVietas, atnaujintiDarboVieta } from "./darboVietos.js";

/**
 * ADP `:changes` sinchronizacijos aprašas darbo vietoms.
 *
 * `syncAdpChanges` bendras INSERT/UPDATE kelias čia netinka – vieną šaltinio
 * eilutę reikia išskaidyti į žodynus, darbdavį ir skelbimą. Todėl `mapping`
 * tik perduoda šaltinio laukus tokius, kokie yra, o visą rašymą atlieka
 * `beforeApply`; `inserts`/`patches` po to ištuštinami, kad bendrasis kelias
 * nebandytų rašyti antrą kartą. Trynimus (`_id`) palieka tvarkyti jam.
 */
export const DARBO_VIETU_SYNC = {
    name: "syncAdpDarboVieta",
    schema: "uzt",
    table: "darboVietos",
    dataset: "datasets/gov/uzt/ldv/Vieta",
    limit: 1000,
    columns: [],
    mapping: Object.fromEntries(
        Object.keys(SALTINIO_LAUKAI).map((laukas) => [laukas, laukas]),
    ),
    beforeApply: async ({ inserts, patches }) => {
        if (inserts.length) {
            await irasytiDarboVietas(inserts.map(paruostiEilute));
            inserts.length = 0;
        }

        for (const { _id, patch } of patches) {
            const paliesti = Object.keys(patch)
                .filter((laukas) => SALTINIO_LAUKAI[laukas] && laukas !== "_id")
                .map((laukas) => SALTINIO_LAUKAI[laukas]);
            if (!paliesti.length) continue;
            await atnaujintiDarboVieta(_id, paruostiEilute(patch), paliesti);
        }
        patches.length = 0;
    },
};
