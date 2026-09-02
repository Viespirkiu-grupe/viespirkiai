import { paruostiEilute, irasytiMokescius, atnaujintiMokesti } from "./mokesciai.js";

/**
 * ADP `:changes` sinchronizacijos aprašas VMI sumokėtiems mokesčiams.
 *
 * Bendras `syncAdpChanges` INSERT/UPDATE kelias čia netinka: `vmi."mokesciai"`
 * normalizuota (pavadinimas, forma, apskritis, savivaldybė – žodynuose), tad
 * `mapping` tik perduoda šaltinio laukus tokius, kokie yra, o rašymą atlieka
 * `beforeApply`; `inserts`/`patches` po to ištuštinami, kad bendrasis kelias
 * nerašytų antrą kartą. Trynimus (pagal `_id`) palieka jam.
 */
const SALTINIO_LAUKAI = [
    "_id", "id", "mm_kodas", "pavadinimas", "tipas",
    "apskritis", "savivaldybe", "metai", "menuo", "suma", "atnaujinta",
];

export const MOKESCIU_SYNC = {
    name: "syncAdpMokesciai",
    schema: "vmi",
    table: "mokesciai",
    dataset: "datasets/gov/vmi/ja_mokesciai/Moketojas",
    limit: 1000,
    columns: [],
    mapping: Object.fromEntries(SALTINIO_LAUKAI.map((laukas) => [laukas, laukas])),
    beforeApply: async ({ inserts, patches }) => {
        if (inserts.length) {
            await irasytiMokescius(inserts.map(paruostiEilute));
            inserts.length = 0;
        }

        for (const { _id, patch } of patches) {
            await atnaujintiMokesti(_id, patch);
        }
        patches.length = 0;
    },
};
