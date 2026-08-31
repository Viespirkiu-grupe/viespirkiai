// Visos `adresuRegistras` schemos lentelės vienu paleidimu.
//
//   npm run adresuRegistras:importuoti                 -- visi žingsniai iš eilės
//   npm run adresuRegistras:importuoti -- gatves adresai   -- tik nurodyti
//   npm run adresuRegistras:importuoti -- --sarasas    -- žingsnių sąrašas
//
// Eiliškumas nėra atsitiktinis: `importApskriciuRibos.js` ir
// `importSavivaldybiuRibos.js` pabaigoje kviečia syncJuridiniaiDictionaries(),
// kuris skaito ką tik įkeltas apskritis ir savivaldybes, todėl jie eina pirmi.
// FK tarp lentelių nėra, tad kiekvieną žingsnį galima paleisti ir atskirai.
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import { closeNats } from "../../utils/natsHub.js";
import { updateAdresai } from "./importAdresai.js";
import { updateApskritys } from "./importApskriciuRibos.js";
import { updateGatves } from "./importGatviuRibos.js";
import { updateGyvenvietesRibos } from "./importGyvenamujuVietoviuRibos.js";
import { updatePastataiSklypaiAdresai } from "./importPastataiSklypai.js";
import { updatePatalposAdresai } from "./importPatalpos.js";
import { updateSavivaldybes } from "./importSavivaldybiuRibos.js";
import { updateSeniunijos } from "./importSeniunijuRibos.js";

const logger = new Logger();

const ZINGSNIAI = [
    { vardas: "apskritys", vykdyti: updateApskritys },
    { vardas: "savivaldybes", vykdyti: updateSavivaldybes },
    { vardas: "seniunijos", vykdyti: updateSeniunijos },
    { vardas: "gyvenvietesRibos", vykdyti: updateGyvenvietesRibos },
    { vardas: "gatves", vykdyti: updateGatves },
    { vardas: "pastataiSklypaiAdresai", vykdyti: updatePastataiSklypaiAdresai },
    { vardas: "patalposAdresai", vykdyti: updatePatalposAdresai },
    { vardas: "adresai", vykdyti: updateAdresai },
];

export async function importuotiAdresuRegistra(vardai = []) {
    const pasirinkti = vardai.length
        ? ZINGSNIAI.filter((z) => vardai.includes(z.vardas))
        : ZINGSNIAI;

    const nezinomi = vardai.filter(
        (v) => !ZINGSNIAI.some((z) => z.vardas === v),
    );
    if (nezinomi.length) {
        throw new Error(
            `Nežinomi žingsniai: ${nezinomi.join(", ")}. Galimi: ${ZINGSNIAI.map((z) => z.vardas).join(", ")}`,
        );
    }

    for (const [i, zingsnis] of pasirinkti.entries()) {
        const pradzia = Date.now();
        logger.log(
            `[${i + 1}/${pasirinkti.length}] adresuRegistras.${zingsnis.vardas} — pradedama`,
        );
        await zingsnis.vykdyti();
        logger.log(
            `[${i + 1}/${pasirinkti.length}] adresuRegistras.${zingsnis.vardas} — baigta per ${Math.round((Date.now() - pradzia) / 1000)} s`,
        );
    }

    return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const argumentai = process.argv.slice(2);
    try {
        if (argumentai.includes("--sarasas")) {
            for (const z of ZINGSNIAI) console.log(z.vardas);
        } else {
            await importuotiAdresuRegistra(argumentai);
        }
    } finally {
        await closeNats().catch(() => {});
        await postgres.end();
    }
}
