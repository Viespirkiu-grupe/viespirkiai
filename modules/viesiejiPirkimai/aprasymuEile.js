import os from "node:os";
import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";
import { FifoRateLimiter } from "../openrouter/fifoRateLimiter.js";
import {
    apiModel,
    getPaskirtis,
    PASKIRTYS,
} from "../openrouter/modelioVariantai.js";
import {
    aprasymoIrankiai,
    aprasytiPirkima,
} from "./aprasymoGeneravimas.js";

/*
AI aprašymų generavimo eilė — `viesiejiPirkimaiAprasymaiQueue`.

Ši eilė į Quickwit NERAŠO nieko: jos darbas baigiasi įrašu į
`viesiejiPirkimaiAprasymai`. Iš ten DB trigeris
(`viesieji_pirkimai_aprasymai_index_queue`) padeda 'patch' į
`viesiejiPirkimaiIndexQueue`, o indeksą rašo tik jo draineris. Taip į vieną
Quickwit doką rašo vienas darbininkas ir nėra lenktynių dėl senstelėjusio
snapshot'o.

Eilę pildo trigeris ant `viesiejiPirkimai` (naujas pirkimas) — žr.
`aprasymuEile.sql`. Ten pat yra ir vienkartinis backlog'o užpildymas.
*/

const logger = new Logger();

/*
Vienas ciklas – vienas pirkimas.

Eilė sąmoningai dirba po vieną: taip niekada nelaikoma daugiau nei viena
rezervacija (mažiau šansų, kad kritus procesui kabotų 24 eilutės iki
LOCK_TIMEOUT) ir LLM apkrova lieka nuspėjama. Worker'is, gavęs `true`, iškart
kartoja ciklą, tad našumo riba yra vieno aprašymo trukmė, o ne cooldown'as.
*/
const BATCH_SIZE = 1;
/** OpenRouter užklausų per sekundę (agento žingsniai eina nuosekliai). */
const RPS = 12.5;
/** Po tiek nesėkmių pirkimas iš eilės nebeimamas (eilutė lieka apžiūrai). */
const MAX_BANDYMAI = 5;
/** Po tiek laiko kritusio darbininko rezervacija laikoma pakibusia. */
const LOCK_TIMEOUT = "30 minutes";

/*
Ar pirkimo failai jau paruošti skaitymui?

`turinioNuskaitymas > 0` reiškia tik tai, kad pirkimo failų ĮRAŠAI jau DB — patys
failai tuo metu dar tik keliauja per parsiuntimo → nuskaitymo → OCR konvejerį, o
ZIP/7z/RAR turinys iškart po scrape'o dar neišskleistas. Aprašius tuo momentu
`get_failas_tekstas` grąžintų „Šis failas neturi teksto", ir santrauka gautųsi iš
vien metaduomenų — nebeatstatomai, nes PK yra (pirkimoId, modelioVariantasId).

Konvejerio invariantas (žr. modules/failai/nuskaitymoEile.js komentarą): eilėse
laikomi TIK neatlikti darbai. Todėl „paruošta" = failo nėra nė vienoje iš trijų
eilių. Archyvai išskleidžiami į `child = true` eilutes su `parent` — jos pačios
praeina tą patį konvejerį, tad tikrinam ir jas (gilesnio lizdinimo nėra: archyvų
archyvuose DB neturi).

Ryšys pirkimas → failai: `sourceTitleId = 'cvpIs'`, `sourceId0 = pirkimoId`
(žr. prisegtiLokaliusFailus.js). Naudoja `files_source_lookup_idx`.
*/
const FAILAI_PARUOSTI_SQL = `
    NOT EXISTS (
        SELECT 1
        FROM public.files f
        WHERE f."sourceTitleId" = (
                  SELECT id FROM public."filesSourceTitles" WHERE title = 'cvpIs'
              )
          AND f."sourceId0" = q."pirkimoId"::text
          AND (
              EXISTS (SELECT 1 FROM public."filesDownloadQueue"   d WHERE d.id = f.id)
           OR EXISTS (SELECT 1 FROM public."filesExtractionQueue" e WHERE e.id = f.id)
           OR EXISTS (SELECT 1 FROM public."filesOcrQueue"        o WHERE o.id = f.id)
           OR EXISTS (
                  SELECT 1
                  FROM public.files c
                  WHERE c.parent = f.id AND c.child = true
                    AND (
                        EXISTS (SELECT 1 FROM public."filesDownloadQueue"   d2 WHERE d2.id = c.id)
                     OR EXISTS (SELECT 1 FROM public."filesExtractionQueue" e2 WHERE e2.id = c.id)
                     OR EXISTS (SELECT 1 FROM public."filesOcrQueue"        o2 WHERE o2.id = c.id)
                    )
              )
          )
    )`;

const NODE_NAME = `${os.hostname()}:${process.pid}`;

let apiKeyWarned = false;
let isjungtaPranesta = false;

/**
 * Įdeda pirkimus į aprašymų eilę.
 *
 * @param {Array<number|string>} pirkimuId
 * @param {import("pg").ClientBase} [klientas]
 * @returns {Promise<number>} kiek eilučių pridėta
 */
export async function iAprasymuEile(pirkimuId, klientas = postgres) {
    if (!pirkimuId?.length) return 0;
    const res = await klientas.query(
        `INSERT INTO public."viesiejiPirkimaiAprasymaiQueue" ("pirkimoId")
         SELECT p."pirkimoId"
         FROM public."viesiejiPirkimai" p
         WHERE p."pirkimoId" = ANY($1::int[])
         ON CONFLICT ("pirkimoId") DO NOTHING`,
        [pirkimuId],
    );
    return res.rowCount;
}

/** Atlaisvina rezervacijas, kurių darbininkas nebegrįžo. */
async function atlaisvintiPakibusius(klientas = postgres) {
    const res = await klientas.query(
        `UPDATE public."viesiejiPirkimaiAprasymaiQueue"
         SET "lockedBy" = NULL, "lockedAt" = NULL
         WHERE "lockedBy" IS NOT NULL
           AND "lockedAt" < NOW() - INTERVAL '${LOCK_TIMEOUT}'`,
    );
    if (res.rowCount) {
        logger.log(`aprasymuEile: atlaisvinta ${res.rowCount} pakibusių rezervacijų`);
    }
    return res.rowCount;
}

/**
 * Rezervuoja porciją pirkimų aprašymui.
 *
 * `NOT EXISTS` prieš šio varianto aprašymus — antra gynybos linija po trigerio:
 * LLM užklausa brangi, o rezultatą jau aprašytam pirkimui vis tiek atmestų
 * `ON CONFLICT DO NOTHING`. Tokios eilutės iš eilės iškart ir išmetamos.
 *
 * Rezervuojami tik tie pirkimai, kurių failai jau perėję parsiuntimo/nuskaitymo/
 * OCR konvejerį (`FAILAI_PARUOSTI_SQL`). Neparuošti lieka eilėje ir bus paimti
 * vėliau — jų neatmetam ir bandymų skaitiklio nedidinam.
 *
 * @param {number} modelioVariantasId
 * @returns {Promise<Array<{ pirkimoId: number, attempts: number }>>}
 */
export async function paimtiAprasymus(
    modelioVariantasId,
    limit = BATCH_SIZE,
    klientas = postgres,
) {
    await klientas.query(
        `DELETE FROM public."viesiejiPirkimaiAprasymaiQueue" q
         WHERE q."lockedBy" IS NULL
           AND EXISTS (
               SELECT 1 FROM public."viesiejiPirkimaiAprasymai" a
               WHERE a."pirkimoId" = q."pirkimoId"
                 AND a."modelioVariantasId" = $1
           )`,
        [modelioVariantasId],
    );

    const { rows } = await klientas.query(
        `WITH cte AS (
            SELECT q."pirkimoId"
            FROM public."viesiejiPirkimaiAprasymaiQueue" q
            WHERE q."lockedBy" IS NULL
              AND q.attempts < $2
              AND (q."nextAttempt" IS NULL OR q."nextAttempt" <= NOW())
              AND ${FAILAI_PARUOSTI_SQL}
            ORDER BY q.priority, q."nextAttempt" NULLS FIRST, q."pirkimoId"
            LIMIT $3
            FOR UPDATE SKIP LOCKED
        )
        UPDATE public."viesiejiPirkimaiAprasymaiQueue" q
        SET "lockedBy" = $1, "lockedAt" = NOW()
        FROM cte
        WHERE q."pirkimoId" = cte."pirkimoId"
        RETURNING q."pirkimoId", q.attempts`,
        [NODE_NAME, MAX_BANDYMAI, limit],
    );
    return rows;
}

/**
 * Pažymi aprašymo rezultatą.
 *
 * Sėkmė IR „nepakanka duomenų" (`success = false`) yra galutiniai atsakymai —
 * eilutė iš eilės dingsta. Tik išimtis (tinklas, modelis, DB) grąžina eilutę su
 * padidintu `attempts` ir eksponentiniu atsitraukimu.
 *
 * @param {number} pirkimoId
 * @param {Error|null} klaida
 */
export async function pazymetiAprasymoRezultata(pirkimoId, klaida, klientas = postgres) {
    if (!klaida) {
        await klientas.query(
            `DELETE FROM public."viesiejiPirkimaiAprasymaiQueue" WHERE "pirkimoId" = $1`,
            [pirkimoId],
        );
        return;
    }

    await klientas.query(
        `UPDATE public."viesiejiPirkimaiAprasymaiQueue"
         SET attempts      = attempts + 1,
             "lockedBy"    = NULL,
             "lockedAt"    = NULL,
             "lastError"   = $2,
             "nextAttempt" = NOW() + (INTERVAL '5 minutes' * POWER(2, LEAST(attempts, 5)))
         WHERE "pirkimoId" = $1`,
        [pirkimoId, klaida.message.replace(/\s+/g, " ").slice(0, 500)],
    );
}

/**
 * Nusausina vieną `viesiejiPirkimaiAprasymaiQueue` porciją.
 *
 * @returns {Promise<boolean>} `true`, kai porcija buvo pilna (yra daugiau darbo).
 */
export async function processViesiejiPirkimaiAprasymaiQueue() {
    if (!process.env.OPENROUTER_API_KEY) {
        if (!apiKeyWarned) {
            apiKeyWarned = true;
            logger.log("aprasymuEile: nėra OPENROUTER_API_KEY — eilė nedirbs");
        }
        return false;
    }

    await atlaisvintiPakibusius();

    // Variantas išsiaiškinamas PRIEŠ rezervaciją — pagal jį atsijojami pirkimai,
    // kurie šiuo modeliu jau aprašyti. Modelis ir įjungimo vėliava — DB
    // lentelėje `aiModelPaskirtys`, tad juos galima keisti nestabdant runner'io.
    const { aktyvus, variant } = await getPaskirtis(PASKIRTYS.VIESUJU_PIRKIMU_APRASYMAS);
    if (!aktyvus) {
        if (!isjungtaPranesta) {
            isjungtaPranesta = true;
            logger.log(
                "aprasymuEile: išjungta per aiModelPaskirtys"
                + ` ("${PASKIRTYS.VIESUJU_PIRKIMU_APRASYMAS}".aktyvus = false) — eilė nedirbs`,
            );
        }
        return false;
    }
    isjungtaPranesta = false;
    const model = apiModel(variant);

    const eile = await paimtiAprasymus(variant.id);
    if (!eile.length) return false;

    const tools = aprasymoIrankiai();
    const rateLimiter = new FifoRateLimiter(RPS);
    // `jauBuvo` po aukščiau esančio atsijojimo turėtų likti 0; nenulinė reikšmė
    // reiškia lenktynes su rankiniu `npm run pirkimai:aprasyti`.
    const stats = { issaugota: 0, neaprasoma: 0, jauBuvo: 0, klaidos: 0 };

    logger.log(`aprasymuEile: paimta ${eile.length} pirkimų · ${model}`);

    for (const { pirkimoId } of eile) {
        try {
            const rezultatas = await aprasytiPirkima({
                pirkimoId,
                variant,
                model,
                tools,
                apiKey: process.env.OPENROUTER_API_KEY,
                beforeRequest: () => rateLimiter.acquire(),
            });
            stats[rezultatas]++;
            await pazymetiAprasymoRezultata(pirkimoId, null);
        } catch (error) {
            stats.klaidos++;
            logger.log(`aprasymuEile: #${pirkimoId} klaida: ${error.message}`);
            await pazymetiAprasymoRezultata(pirkimoId, error);
        }
    }

    logger.log(
        `aprasymuEile: ${stats.issaugota} išsaugota · ${stats.neaprasoma} neaprašomi`
        + ` · ${stats.jauBuvo} jau buvo · ${stats.klaidos} klaidų`,
    );

    // Trigeris jau pridėjo 'patch' eilutes į viesiejiPirkimaiIndexQueue —
    // pažadinam jų drainer'į, kad aprašymai paieškoje atsirastų iškart.
    if (stats.issaugota) {
        signalWork(WORK_SIGNALS.VIESIEJI_PIRKIMAI_CHANGED, {
            source: "viesiejiPirkimaiAprasymaiQueue",
            count: stats.issaugota,
        });
    }

    return eile.length === BATCH_SIZE;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let stopping = false;
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            if (stopping) process.exit(130);
            stopping = true;
            logger.log("aprasymuEile: stabdoma, baigiama porcija…");
        });
    }
    while (!stopping && await processViesiejiPirkimaiAprasymaiQueue()) {
        // tuščia — visas darbas porcijoje
    }
    await postgres.end();
    process.exit(0);
}
