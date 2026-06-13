import { rastiEsInvesticijosPareiskejoJarKoda } from "../modules/2014esinvesticijos/rastiPareiskejuKodus.js";
import { update2014EsInvesticijosData } from "../modules/2014esinvesticijos/scrape.js";
import { nuskaitytiCpvaProjektaiTiekejai } from "../modules/cpva/scrapeProjektai.js";
import { nuskaitytiPinregDeklaracija } from "../modules/pinreg/nuskaityti.js";
import { getNewestPinreg } from "../modules/pinreg/scrapeNewest.js";
import { nuskaitytiDomregDomena } from "../modules/domenai/scrapeDomreg.js";
import { litekoScrapeLatestDays } from "../modules/liteko/scrape.js";
import { surastiNuosprendzioDalyvius } from "../modules/liteko/scrapeContent.js";
import { pravalytiOcrRezervacijas } from "../modules/ocr/pravalytiRezervacijas.js";
import { geolocateJarCsv } from "../modules/juridiniai/findCoordinates.js";
import { nuskaitytiInformaciniusLeidinius } from "../modules/registruCentrasPranesimai/scrape.js";
import { nuskaitytiInformaciniLeidini } from "../modules/registruCentrasPranesimai/scrapeContent.js";
import { nuskaitytiVisasNeskelbiamasDerybas } from "../modules/neskelbiamosDerybos/scrape.js";
import { importuotiMelagingusTiekejus } from "../modules/vptSarasai/melagingiScrape.js";
import { importuotiNepatikimusTiekejus } from "../modules/vptSarasai/nepatikimiScrape.js";
import { nuskaitytiMvpTvarkosAprasuSubjektus } from "../modules/mvpTvarkosAprasai/scrape.js";
import { scrapeMvmUntilNow } from "../modules/mvpTvarkosAprasai/scrapeContent.js";
import { updateVdiPazeidimai } from "../modules/vdi/scrapePazeidimai.js";
import { processSuggestionQueue } from "../modules/searchSuggestion/processSuggestionQueue.js";
import { deleteDeadIndexes } from "../quickwit/deleteDeadIndexes.js";
import { processDomenaiAdpQueue } from "../modules/domenai/processAdpQueue.js";

export default [
    {
        name: "rastiEsInvesticijosPareiskejoJarKoda",
        mode: "asap",
        priority: 5,
        cooldown: 60,
        errorCooldown: 10,
        job: rastiEsInvesticijosPareiskejoJarKoda,
    },
    {
        name: "update2014EsInvesticijosData",
        schedule: "47 */3 * * *",
        job: update2014EsInvesticijosData,
    },
    {
        name: "nuskaitytiCpvaProjektaiTiekejai",
        schedule: "0 */1 * * *",
        job: nuskaitytiCpvaProjektaiTiekejai,
    },
    {
        name: "nuskaitytiPinregDeklaracijas",
        mode: "asap",
        priority: 8,
        cooldown: 60,
        errorCooldown: 10,
        job: nuskaitytiPinregDeklaracija,
    },
    {
        name: "getNewestPinreg",
        schedule: "0 */1 * * *",
        job: async () => {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            await getNewestPinreg(weekAgo);
        },
    },
    {
        name: "nuskaitytiDomregDomena",
        mode: "asap",
        priority: 2,
        cooldown: 30,
        errorCooldown: 10,
        job: async () => {
            const processed = await nuskaitytiDomregDomena();
            if (processed) await new Promise((r) => setTimeout(r, 500));
            return processed;
        },
    },
    {
        name: "scrapeLiteko",
        schedule: "0 */6 * * *",
        job: async () => litekoScrapeLatestDays(90),
    },
    {
        name: "scrapeLitekoSalys",
        mode: "asap",
        priority: 5,
        cooldown: 60,
        errorCooldown: 10,
        job: surastiNuosprendzioDalyvius,
    },
    {
        name: "pravalytiOcrRezervacijas",
        mode: "asap",
        priority: 4,
        cooldown: 60,
        errorCooldown: 60,
        job: pravalytiOcrRezervacijas,
    },
    {
        name: "geolocateJarCsv",
        mode: "asap",
        priority: 2,
        cooldown: 60,
        errorCooldown: 60,
        job: geolocateJarCsv,
    },
    {
        name: "nuskaitytiInformaciniusLeidinius",
        schedule: "0 */3 * * *",
        job: nuskaitytiInformaciniusLeidinius,
    },
    {
        name: "nuskaitytiInformaciniLeidini",
        mode: "asap",
        priority: 5,
        cooldown: 60,
        errorCooldown: 10,
        job: nuskaitytiInformaciniLeidini,
    },
    {
        name: "nuskaitytiVisasNeskelbiamasDerybas",
        schedule: "0 */3 * * *",
        job: nuskaitytiVisasNeskelbiamasDerybas,
    },
    {
        name: "importuotiMelagingusTiekejus",
        schedule: "0 */1 * * *",
        job: importuotiMelagingusTiekejus,
    },
    {
        name: "importuotiNepatikimusTiekejus",
        schedule: "0 */1 * * *",
        job: importuotiNepatikimusTiekejus,
    },
    {
        // Pirma atnaujinamas subjektų sąrašas, tada (vėliau) jų turinys
        name: "nuskaitytiMvpTvarkosAprasuSubjektus",
        schedule: "0 5 * * *",
        job: nuskaitytiMvpTvarkosAprasuSubjektus,
    },
    {
        name: "scrapeMvpTvarkosAprasai",
        schedule: "30 5 * * *",
        job: scrapeMvmUntilNow,
    },
    {
        name: "updateVdiPazeidimai",
        schedule: "0 4 * * *",
        job: updateVdiPazeidimai,
    },
    {
        name: "deleteDeadQuickwitIndexes",
        schedule: "43 3 * * *",
        job: async () => {
            const { failed } = await deleteDeadIndexes();
            if (failed) throw new Error(`Nepavyko ištrinti ${failed} Quickwit indeksų`);
        },
    },
    {
        name: "processSearchSuggestionQueue",
        mode: "asap",
        priority: 5,
        cooldown: 30,
        errorCooldown: 30,
        job: processSuggestionQueue,
    },
    {
        name: "processDomenaiAdpQueue",
        mode: "asap",
        priority: 4,
        cooldown: 30,
        errorCooldown: 60,
        job: processDomenaiAdpQueue,
    },
];
