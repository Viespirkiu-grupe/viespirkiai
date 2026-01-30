import cron from "node-cron";
import { postgres } from "./postgres/postgres.js";
import { log } from "./utils/log.js";

const tasks = [];

// CPVA projektai
import { nuskaitytiCpvaProjektaiTiekejai } from "./tasks/cpva/scrapeProjektai.js";
tasks.push({
    name: "nuskaitytiCpvaProjektaiTiekejai",
    schedule: "0 */1 * * *",
    job: async () => {
        await nuskaitytiCpvaProjektaiTiekejai();
    },
});

// VTEK deklaracijos
import { nuskaitytiVtekDeklaracija } from "./tasks/vtek/nuskaityti.js";
tasks.push({
    name: "nuskaitytiVtekDeklaracijas",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 10,
    job: async () => {
        return nuskaitytiVtekDeklaracija();
    },
});

import { getNewestPinreg } from "./tasks/vtek/scrapeNewest.js";
tasks.push({
    name: "getNewestPinreg",
    schedule: "0 */1 * * *",
    job: async () => {
        let weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        await getNewestPinreg(weekAgo);
    },
});

// eViesiejiPirkimai.lt sutartys
import { requestLatestEviesiejipirkimaiData } from "./tasks/sutartys/scrape.js";
tasks.push({
    name: "scrapeEviesiejipirkimaiSutartys",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return requestLatestEviesiejipirkimaiData();
    },
    nextTaskId: "failuParsiuntimas",
});

// eViesiejiPirkimai.lt failai
import { parsiustiFaila } from "./tasks/failai/parsiusti.js";
tasks.push({
    name: "failuParsiuntimas",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 0,
    job: async () => {
        return parsiustiFaila();
    },
});

tasks.push({
    name: "failuParsiuntimas2",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 0,
    job: async () => {
        return parsiustiFaila();
    },
});

// LITEKO bylų metaduomenys (paieškos rezultatai)
import { litekoScrapeLatestDays } from "./tasks/liteko/scrape.js";
tasks.push({
    name: "scrapeLiteko",
    schedule: "0 */6 * * *",
    job: async () => {
        await litekoScrapeLatestDays(90);
    },
});

// LITEKO bylų duomenys (individualios bylos informacija)
import { surastiBylosSalis } from "./tasks/liteko/scrapeContent.js";
tasks.push({
    name: "scrapeLitekoSalys",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 10,
    job: async () => {
        return surastiBylosSalis();
    },
});

// Pravalyti OCR rezervacijas
import { pravalytiOcrRezervacijas } from "./tasks/ocr/pravalytiRezervacijas.js";
tasks.push({
    name: "pravalytiOcrRezervacijas",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return pravalytiOcrRezervacijas();
    },
});

// JAR adresų koordinatės iš Nominatim / OpenStreetMap
import { atrastiJarAdresoKoordinates } from "./tasks/adresai/scrape.js";
tasks.push({
    name: "scrapeJarAdresoKoordinates",
    mode: "asap",
    cooldown: 60 * 60,
    errorCooldown: 10,
    job: async () => {
        return atrastiJarAdresoKoordinates();
    },
});

// Sync ADP changes
import { syncAdpChanges } from "./tasks/adp/syncChanges.js";
tasks.push({
    name: "syncAdpSaskaitosSalys",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "sabisSaskaituSalys",
            dataset:
                "datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/SaskaituSalys",
            mapping: {
                _type: "_type",
                _id: "_id",
                _revision: "_revision",
                id: "id",
                sf_id: "sfId",
                tipas: "tipas",
                validus_asmens_kodas: "validusAsmensKodas",
                validus_jar_kodas: "validusJarKodas",
                kitas_kodas: "kitasKodas",
                kitas_kodas_paaiskinimas: "kitasKodasPaaiskinimas",
                pavadinimas: "pavadinimas",
                ne_pvm_moketojas: "nePvmMoketojas",
                veiklos_vieta: "veiklosVieta",
                data: "data",
            },
            limit: 1000,
        });
    },
});

tasks.push({
    name: "syncAdpSutartysSalys",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "sabisSutarciuSalys",
            dataset:
                "datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/SutarciuSalys",
            mapping: {
                _type: "_type",
                _id: "_id",
                _revision: "_revision",
                id: "id",
                sutarties_id: "sutartiesId",
                tipas: "tipas",
                validus_asmens_kodas: "validusAsmensKodas",
                validus_jar_kodas: "validusJarKodas",
                kitas_kodas: "kitasKodas",
                pavadinimas: "pavadinimas",
                ne_pvm_moketojas: "nePvmMoketojas",
                veiklos_vieta: "veiklosVieta",
                data: "data",
            },
            limit: 1000,
        });
    },
});

tasks.push({
    name: "syncAdpSabisSaskaitos",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "sabisSaskaitos",
            dataset: "datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/Saskaitos",
            mapping: {
                _id: "_id",
                _revision: "_revision",
                id: "id",
                sf_id: "sfId",
                israsymo_data: "israsymoData",
                sf_pozymis: "sfPozymis",
                sf_tipas: "sfTipas",
                sf_numeris: "sfNumeris",
                sutarties_uid: "sutartiesUid",
                sutarties_numeris: "sutartiesNumeris",
                cpv_kodas: "cpvKodas",
                cpv_pav: "cpvPav",
                sf_apmokejimo_terminas: "sfApmokejimoTerminas",
                pvm: "pvm",
                suma_be_pvm: "sumaBePvm",
                suma_pvm: "sumaPvm",
                bendra_sf_suma: "bendraSfSuma",
                valiuta: "valiuta",
                sf_busena: "sfBusena",
                sf_buseno_data: "sfBusenoData",
            },
            limit: 1000,
        });
    },
});

tasks.push({
    name: "syncAdpSabisSutartys",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "sabisSutartys",
            dataset: "datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/Sutartys",
            mapping: {
                _type: "_type",
                _id: "_id",
                _revision: "_revision",
                sutarties_id: "sutartiesId",
                sutarties_uid: "sutartiesUid",
                vp_id: "vpId",
                tipas: "tipas",
                sutarties_numeris: "sutartiesNumeris",
                pavadinimas: "pavadinimas",
                cpv_kodas: "cpvKodas",
                cpv_pav: "cpvPav",
                sutarties_pasirasymo_data: "sutartiesPasirasymoData",
                sutarties_galiojimo_data: "sutartiesGaliojimoData",
                suma: "suma",
            },
            limit: 500,
        });
    },
});

tasks.push({
    name: "syncAdpBalansoAtaskaitos",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "balansoAtaskaitos",
            dataset: "datasets/gov/rc/jar/balanso_ataskaitos/BalansoAtaskaita",
            mapping: {
                _id: "_id",
                "juridinis_asmuo._id": "jarId",
                "forma._id": "formaId",
                "statusas._id": "statusasId",
                template_id: "templateId",
                template_name: "templateName",
                standard_id: "standardId",
                standard_name: "standardName",
                line_type_id: "lineTypeId",
                line_name: "lineName",
                reiksme: "reiksme",
                laikotarpis_nuo: "laikotarpisNuo",
                laikotarpis_iki: "laikotarpisIki",
                reg_date: "duomenuData",
            },
            limit: 2500,
        });
    },
});
tasks.push({
    name: "syncAdpGyvenamojiVietove",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "gyvenamosVietoves",
            dataset: "datasets/gov/rc/ar/gyvenamojivietove/GyvenamojiVietove",
            columns: [
                "_id",
                "gyvKodas",
                "tipas",
                "tipoSantrumpa",
                "pavadinimasK",
                "pavadinimas",
                "seniunija",
                "savivaldybe",
                "gyvNuo",
                "gyvIki",
            ],
            mapping: {
                _id: "_id",
                gyv_kodas: "gyvKodas",
                tipas: "tipas",
                tipo_santrumpa: "tipoSantrumpa",
                pavadinimas_k: "pavadinimasK",
                pavadinimas: "pavadinimas",
                "seniunija._id": "seniunija",
                "savivaldybe._id": "savivaldybe",
                gyv_nuo: "gyvNuo",
                gyv_iki: "gyvIki",
            },
            limit: 1000,
        });
    },
});

tasks.push({
    name: "syncAdpIstatinisKapitalas",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "istatinisKapitalas",
            dataset: "datasets/gov/rc/jar/ja_kapitalas/JuridinisAsmuoKapitalas",
            mapping: {
                _id: "_id",
                "juridinis_asmuo._id": "jarId",
                "forma._id": "formaId",
                data_nuo: "data",
                reiksme: "reiksme",
                valiuta: "valiuta",
            },
            limit: 1000,
        });
    },
});

tasks.push({
    name: "syncAdpJadis",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "jadis",
            dataset: "datasets/gov/rc/jadis/dalyviai/Dalyvis",
            mapping: {
                _id: "_id",
                "juridinis_asmuo._id": "jarId",
                "form_kodas._id": "formaId",
                "stat_statusas._id": "statusasId",
                lr_fiziniai: "lrFiziniai",
                lr_juridiniai: "lrJuridiniai",
                uzsienio_fiziniai: "uzsienioFiziniai",
                uzsienio_juridiniai: "uzsienioJuridiniai",
            },
            limit: 1000,
        });
    },
});

tasks.push({
    name: "syncAdpJar",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "jar",
            dataset: "datasets/gov/rc/jar/iregistruoti/JuridinisAsmuo",
            mapping: {
                _id: "_id",
                ja_kodas: "jarKodas",
                ja_pavadinimas: "pavadinimas",
                pilnas_adresas: "adresas",
                "adresas._id": "adresasId",
                reg_data: "registravimoData",
                isreg_data: "isregistravimoData",
                "forma._id": "formaId",
                "statusas._id": "statusasId",
                stat_data: "statusasData",
            },
            limit: 1000,
        });
    },
});

tasks.push({
    name: "syncAdpMokesciai",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "mokesciai",
            dataset: "datasets/gov/vmi/ja_mokesciai/Moketojas",
            mapping: {
                _id: "_id",
                id: "id",
                "mm_kodas._id": "mm_kodas_id",
                jarKodas: "jarKodas",
                pavadinimas: "pavadinimas",
                tipas: "formosPavadinimas",
                "apskritis._id": "apskritis",
                "savivaldybe._id": "savivaldybe",
                metai: "metai",
                menuo: "menuo",
                suma: "suma",
                atnaujinta: "duomenuData",
            },
            limit: 1000,
        });
    },
});

tasks.push({
    name: "syncAdpPelnoNuostoliuAtaskaitos",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "pelnoNuostoliuAtaskaitos",
            dataset: "datasets/gov/rc/jar/pelno_ataskaitos/PelnoAtaskaita",
            mapping: {
                _id: "_id",
                "juridinis_asmuo._id": "jarId",
                "forma._id": "formaId",
                "statusas._id": "statusasId",
                template_id: "templateId",
                template_name: "templateName",
                standard_id: "standardId",
                standard_name: "standardName",
                line_type_id: "lineTypeId",
                line_name: "lineName",
                reiksme: "reiksme",
                laikotarpis_nuo: "laikotarpisNuo",
                laikotarpis_iki: "laikotarpisIki",
                reg_date: "duomenuData",
            },
            limit: 1000,
        });
    },
});

tasks.push({
    name: "syncAdpDarboVietos",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return await syncAdpChanges({
            table: "darboVietos",
            dataset: "datasets/gov/uzt/ldv/Vieta",
            mapping: {
                _type: "_type",
                _id: "_id",
                _revision: "_revision",
                darbo_vietos_id: "darboVietosId",
                ikelimo_data: "ikelimoData",
                profesijos_pareigybes_kodas: "profesijosPareigybesKodas",
                profesijos_pareigybes_pav: "profesijosPareigybesPav",
                darbo_aprasymas_lt: "darboAprasymasLt",
                galioja_nuo: "galiojaNuo",
                galioja_iki: "galiojaIki",
                ar_aktuali_siandien: "arAktualiSiandien",
                ar_uzpildyta: "arUzpildyta",
                pageidaujama_darbo_pradzia: "pageidaujamaDarboPradzia",
                darbo_vietu_skaicius: "darboVietuSkaicius",
                darbo_vietos_adresas: "darboVietosAdresas",
                darbo_vietos_sav_pav: "darboVietosSavPav",
                registravimo_pagrindo_kodas: "registravimoPagrindoKodas",
                registravimo_pagrindo_pav: "registravimoPagrindoPav",
                registravimo_budo_kodas: "registravimoBudoKodas",
                registravimo_budo_pav: "registravimoBudoPav",
                pageidavimo_pateikimo_kodas: "pageidavimoPateikimoKodas",
                pageidavimo_pateikimo_pav: "pageidavimoPateikimoPav",
                ar_papildomai_remia: "arPapildomaiRemia",
                ar_darbina_po_mokymu: "arDarbinaPoMokymu",
                ar_apmoka_keliones: "arApmokaKeliones",
                ar_apgyvendina: "arApgyvendina",
                ar_maitina: "arMaitina",
                rizikos_lt: "rizikosLt",
                jar_kodas: "jarKodas",
                darbdavys: "darbdavys",
                teisinio_statuso_kodas: "teisinioStatusoKodas",
                teisinio_statuso_pav: "teisinioStatusoPav",
                teisines_formos_kodas: "teisinesFormosKodas",
                teisines_formos_pav: "teisinesFormosPav",
                imones_iregistravimas: "imonesIregistravimas",
                darbdavio_bustine: "darbdavioBustine",
                reik_darbo_patirtis: "reikDarboPatirtis",
                reik_kompetencijos_lt: "reikKompetencijosLt",
                reik_gebejimai: "reikGebejimai",
                reik_issilavinimo_kodas: "reikIssilavinimoKodas",
                reik_issilavinimo_pav: "reikIssilavinimoPav",
                reik_mok_progr_kodas: "reikMokProgrKodas",
                reik_mok_progr_pav: "reikMokProgrPav",
            },
            limit: 1000,
        });
    },
});

tasks.push({
    name: "syncAdpGyvenamojiVietove",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return syncAdpChanges({
            table: "gyvenamosVietoves",
            dataset: "datasets/gov/rc/ar/gyvenamojivietove/GyvenamojiVietove",
            columns: [
                "_id",
                "gyvKodas",
                "tipas",
                "tipoSantrumpa",
                "pavadinimasK",
                "pavadinimas",
                "seniunija",
                "savivaldybe",
                "gyvNuo",
                "gyvIki",
            ],
            mapping: {
                _id: "_id",
                gyv_kodas: "gyvKodas",
                tipas: "tipas",
                tipo_santrumpa: "tipoSantrumpa",
                pavadinimas_k: "pavadinimasK",
                pavadinimas: "pavadinimas",
                "seniunija._id": "seniunija",
                "savivaldybe._id": "savivaldybe",
                gyv_nuo: "gyvNuo",
                gyv_iki: "gyvIki",
            },
            limit: 1000,
        });
    },
});

import { nuskaitytiInformaciniusLeidinius } from "./tasks/informaciniaiLeidiniai/scrape.js";
tasks.push({
    name: "nuskaitytiInformaciniusLeidinius",
    schedule: "0 */3 * * *",
    job: async () => {
        await nuskaitytiInformaciniusLeidinius();
    },
});

import { nuskaitytiInformaciniLeidini } from "./tasks/informaciniaiLeidiniai/scrapeContent.js";
tasks.push({
    name: "nuskaitytiInformaciniLeidini",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 10,
    job: async () => {
        return nuskaitytiInformaciniLeidini();
    },
});

// eViesiejiPirkimai.lt neskelbiamos derybos
import { nuskaitytiVisasNeskelbiamasDerybas } from "./tasks/neskelbiamosDerybos/scrape.js";
tasks.push({
    name: "nuskaitytiVisasNeskelbiamasDerybas",
    schedule: "0 */3 * * *",
    job: async () => {
        await nuskaitytiVisasNeskelbiamasDerybas();
    },
});

// vpt.lrv.lt (SharePoint) melagingi tiekėjai
import { importuotiMelagingusTiekejus } from "./tasks/melagiai/scrape.js";
tasks.push({
    name: "importuotiMelagingusTiekejus",
    schedule: "0 */1 * * *",
    job: async () => {
        await importuotiMelagingusTiekejus();
    },
});

// vpt.lrv.lt (SharePoint) nepatikimi tiekėjai
import { importuotiNepatikimusTiekejus } from "./tasks/nepatikimi/scrape.js";
tasks.push({
    name: "importuotiNepatikimusTiekejus",
    schedule: "0 */1 * * *",
    job: async () => {
        await importuotiNepatikimusTiekejus();
    },
});

// Failų turinio nuskaitymas
import { nuskaitytiVienoDokumentoDuomenis } from "./tasks/failai/nuskaitytiTeksta.js";

const runningTasks = new Map();
function startAsapTask(
    id,
    jobFn,
    cooldownSec = 60,
    errorCooldownSec = 300,
    nextTaskId,
) {
    if (runningTasks.has(id)) return;

    const controller = { cancelled: false };
    controller.promise = (async function loop() {
        const cooldown = cooldownSec * 1000;
        const errorCooldown = errorCooldownSec * 1000;

        while (!controller.cancelled) {
            try {
                const result = await jobFn();

                // try to start next task immediately if specified
                if (nextTaskId && !runningTasks.has(nextTaskId)) {
                    const nextTask = tasks.find((t) => t.name === nextTaskId);
                    if (nextTask) {
                        startAsapTask(
                            nextTask.name,
                            nextTask.job,
                            nextTask.cooldown,
                            nextTask.errorCooldown,
                            nextTask.nextTask,
                        );
                    }
                }

                // wait cooldown only if job returned false
                if (result === false) {
                    await new Promise((r) => setTimeout(r, cooldown));
                }
            } catch (err) {
                console.error(`ASAP Task ${id} failed:`, err.message);
                await new Promise((r) => setTimeout(r, errorCooldown));
            }
        }
    })();

    runningTasks.set(id, controller);
    log(`Started ASAP task: ${id}`);
}

function stopAsapTask(id) {
    const controller = runningTasks.get(id);
    if (!controller) return;
    controller.cancelled = true;
    runningTasks.delete(id);
    log(`Stopped ASAP task: ${id}`);
}

// --- Periodic sync of dokumentų nuskaitytojai from Postgres ---
async function syncDokNuskaitytojai() {
    const rows = await postgres.query(`
        SELECT *
        FROM "dokNuskaitytojai"
        WHERE enabled = true
    `);

    const dbIds = new Set();

    // Start new ASAP tasks
    for (const row of rows.rows) {
        for (let i = 0; i < row.concurrency; i++) {
            const taskKey = `nuskaitytiDokumenta-${row.id}-${i}`;
            dbIds.add(taskKey);

            if (!runningTasks.has(taskKey)) {
                startAsapTask(
                    taskKey,
                    async () => nuskaitytiVienoDokumentoDuomenis(row.id),
                    10, // or row.cooldown if you store it in DB
                    1, // or row.errorCooldown if you store it in DB
                );
            }
        }
    }

    // Stop tasks that no longer exist or disabled
    for (const id of runningTasks.keys()) {
        if (!dbIds.has(id) && id.startsWith("nuskaitytiDokumenta")) {
            log(`Stopping task ${id}`);
            stopAsapTask(id);
        }
    }
}

// Initial sync
await syncDokNuskaitytojai();

// Sync every 10 seconds
setInterval(syncDokNuskaitytojai, 10_000);

for (const task of tasks) {
    if (task.mode === "asap") {
        startAsapTask(
            task.name,
            task.job,
            task.cooldown ?? 60,
            task.errorCooldown ?? 300,
            task.nextTaskId ?? null,
        );
    } else {
        // Cron-based tasks
        let running = false;

        cron.schedule(task.schedule, async () => {
            if (running) return;

            running = true;
            try {
                await task.job();
            } catch (err) {
                console.error(`Task ${task.name} failed:`, err.message);
            } finally {
                running = false;
            }
        });
    }
}
