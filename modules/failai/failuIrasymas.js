import { postgres } from "../../postgres/postgres.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

/*
Bendras failų įrašymo taškas — rašoma tik į naują (files) schemą.

Kodėl vienoje vietoje
---------------------
Iki šiol tas pats INSERT buvo nukopijuotas septyniose vietose (penki scraperiai,
sutarčių importas, archyvo išskleidimas), kiekvienoje su savo placeholder'ių
konstrukcija. Perėjus į `files` kiekvienam jų reikėtų dar ir šaltinio ID skaidymo
bei žodynų — todėl visa tai gyvena čia, o kvietimo vietose lieka vienas
`irasytiFailus(eilutes)`.

Dublikatai
----------
Seni duomenys perkelti (sql/perkeltiIFiles.sql), į `failai` nebeberašoma, o `files.id`
generuoja pati lentelė. Pakartotinius įrašus atmeta `files` unikalūs indeksai:
  - `files_source_uniq` (sourceTitleId + sourceId0..3) — „tėvams";
  - `files_child_uniq` (parent + sourceId0) — archyvo vaikams.

Šaltinio ID skaidymas
---------------------
`failai.saltinioId` yra vienas tekstas, iš kurio kodas pats išsipjauna dalis
(pvz. aptarnavimas.js daro split("/")). `files` jas laiko atskiruose stulpeliuose
`sourceId0..3`. Skaidymo taisyklė priklauso nuo šaltinio (žr. SALTINIAI):

    sutartys              dokId / fileId               → sourceId0, sourceId1
    cvpIs                 pirkimoId/dokumentasId/versionId → sourceId0..2
    cvpp                  pid/dvid/lid                 → sourceId0..2
    neskelbiamosDerybos   kelias (sutikimai_laikini/…) → sourceId0
    mvpAprasai            kelias (vpm/K22N_FILES/…)    → sourceId0
    archive               kelias archyvo viduje        → sourceId0

`cvpp` turi ir seną dviejų dalių formą be `pid` (scrapeNotice.js:62-63) — tokiu atveju
`pid = -1`, kad dalių tvarka visada liktų ta pati (pid, dvid, lid).

`neskelbiamosDerybos` ir `mvpAprasai` yra keliai, o ne sudėtiniai raktai: jų dalys
neturi savarankiškos prasmės, o linkai atkuriami paprastu sujungimu, todėl laikomi
vientisi.

`sutartys` ypatumai
-------------------
Šaltinis gali ateiti dviem pavidalais: atskirais `dokId`/`fileId` laukais arba vienu
`saltinioId = "dokId/fileId"`. Palaikomi abu. Jei `saltinis` išvis nenurodytas,
laikoma, kad tai `sutartys` — senoje schemoje tokių eilučių buvo 2 085 576 (visos su
dokId+fileId), ir būtent ta prielaida buvo pritaikyta perkeliant duomenis.
*/

/** Šaltinis, laikomas numatytuoju, kai `saltinis` nenurodytas. */
export const NUMATYTASIS_SALTINIS = "sutartys";

/** Šaltinis, kuriuo žymimi iš archyvo išskleisti vaikai. */
export const ARCHYVO_SALTINIS = "archive";

/** `parsiustas` reikšmė failams, kurių parsiųsti nereikia (išskleisti iš archyvo). */
const PARSIUSTAS_ISARCHYVO = -5;

/**
 * Šaltinių registras: kaip `saltinioId` virsta `sourceId0..3` ir atgal.
 * `skaidyti` grąžina masyvą (trumpesnis nei 4 — likusieji bus null),
 * `sujungti` iš to paties masyvo atkuria originalų `saltinioId`.
 */
const SALTINIAI = {
    sutartys: {
        skaidyti: (id) => id.split("/", 2),
        sujungti: (d) => d.filter((x) => x != null).join("/"),
    },
    cvpIs: {
        skaidyti: (id) => id.split("/"),
        sujungti: (d) => d.filter((x) => x != null).join("/"),
    },
    cvpp: {
        // Sena forma "dvid/lid" — pid nežinomas, todėl -1.
        skaidyti: (id) => {
            const dalys = id.split("/");
            return dalys.length >= 3 ? dalys : ["-1", ...dalys];
        },
        sujungti: (d) => {
            const dalys = d.filter((x) => x != null);
            return dalys[0] === "-1" ? dalys.slice(1).join("/") : dalys.join("/");
        },
    },
    neskelbiamosDerybos: VIENTISAS(),
    mvpAprasai: VIENTISAS(),
    [ARCHYVO_SALTINIS]: VIENTISAS(),
};

/** Šaltinis, kurio ID nedalinamas — visas tekstas lieka sourceId0. */
function VIENTISAS() {
    return {
        skaidyti: (id) => [id],
        sujungti: (d) => d[0] ?? null,
    };
}

/** Nežinomam šaltiniui — nedalinam, kad nieko neprarastume. */
const ATSARGINIS = VIENTISAS();

/**
 * Išskaido `saltinioId` į keturias pozicijas pagal šaltinio taisyklę.
 * @param {string|null} saltinis
 * @param {string|null} saltinioId
 * @returns {[string|null, string|null, string|null, string|null]}
 */
export function skaidytiSaltinioId(saltinis, saltinioId) {
    if (saltinioId == null || saltinioId === "") return [null, null, null, null];
    const taisykle = SALTINIAI[saltinis ?? NUMATYTASIS_SALTINIS] ?? ATSARGINIS;
    const dalys = taisykle.skaidyti(String(saltinioId));
    return [0, 1, 2, 3].map((i) => dalys[i] ?? null);
}

/**
 * Atvirkštinis veiksmas — iš `sourceId0..3` atkuria `saltinioId`.
 * Naudinga linkų konstravimui ir migracijos patikrai (skaidyti → sujungti turi
 * grąžinti tą patį tekstą).
 * @param {string|null} saltinis
 * @param {Array<string|null>} dalys
 * @returns {string|null}
 */
export function sujungtiSaltinioId(saltinis, dalys) {
    const reiksmes = dalys.filter((x) => x != null && x !== "");
    if (!reiksmes.length) return null;
    const taisykle = SALTINIAI[saltinis ?? NUMATYTASIS_SALTINIS] ?? ATSARGINIS;
    return taisykle.sujungti(reiksmes);
}

/**
 * Suveda įrašomą eilutę į vieną pavidalą, nesvarbu kaip ji atėjo.
 * Priima: { saltinis?, saltinioId?, dokId?, fileId?, pavadinimas?, extension?,
 *           parent?, parsiustas? }
 */
function normalizuoti(eilute) {
    const saltinis = eilute.saltinis ?? NUMATYTASIS_SALTINIS;

    // sutartys: arba atskiri laukai, arba "dokId/fileId" viename saltinioId.
    let dokId = eilute.dokId ?? null;
    let fileId = eilute.fileId ?? null;
    let saltinioId = eilute.saltinioId ?? null;

    if (saltinis === NUMATYTASIS_SALTINIS) {
        if ((dokId == null || fileId == null) && saltinioId) {
            const [d, f] = String(saltinioId).split("/", 2);
            dokId = dokId ?? (d ? Number(d) : null);
            fileId = fileId ?? (f ? Number(f) : null);
        }
        // failai lentelėje sutartys laikomos stulpeliuose, ne saltinioId
        saltinioId = null;
    }

    const dalys =
        saltinis === NUMATYTASIS_SALTINIS
            ? [dokId == null ? null : String(dokId), fileId == null ? null : String(fileId), null, null]
            : skaidytiSaltinioId(saltinis, saltinioId);

    const parent = eilute.parent ?? null;

    return {
        saltinis,
        saltinioId,
        dokId,
        fileId,
        pavadinimas: eilute.pavadinimas ?? null,
        // Tuščias plėtinys žodyne neprasmingas — verčiam į null.
        extension: eilute.extension ? String(eilute.extension).toLowerCase() : null,
        parent,
        parsiustas: eilute.parsiustas ?? (parent != null ? PARSIUSTAS_ISARCHYVO : 0),
        // Archyvo vaikams jie žinomi iš karto, kitiems atsiranda tik parsisiuntus.
        md5: eilute.md5 ?? null,
        dydis: eilute.dydis ?? null,
        dalys,
    };
}

/**
 * Užtikrina žodyno eilutes ir grąžina reikšmė → id žemėlapį.
 * @param {import("pg").ClientBase} klientas
 * @param {string} lentele - pvz. "filesExtensions"
 * @param {string} stulpelis - pvz. "extension"
 * @param {Array<string|null>} reiksmes
 * @returns {Promise<Map<string, number>>}
 */
async function zodynoId(klientas, lentele, stulpelis, reiksmes) {
    const unikalios = [...new Set(reiksmes.filter((v) => v != null && v !== ""))];
    if (!unikalios.length) return new Map();

    await klientas.query(
        `INSERT INTO public."${lentele}" ("${stulpelis}")
         SELECT DISTINCT v FROM unnest($1::text[]) v
         ON CONFLICT ("${stulpelis}") DO NOTHING`,
        [unikalios],
    );

    const { rows } = await klientas.query(
        `SELECT id, "${stulpelis}" AS reiksme
         FROM public."${lentele}"
         WHERE "${stulpelis}" = ANY($1::text[])`,
        [unikalios],
    );

    return new Map(rows.map((r) => [r.reiksme, r.id]));
}

/**
 * Įrašo eilutes į `files` ir grąžina naujai sukurtų id sąrašą.
 * Dublikatus atmeta unikalūs indeksai, tad kviečiantiesiems savo patikros nebūtina.
 */
async function irasytiIFiles(klientas, eilutes) {
    if (!eilutes.length) return [];

    // Nuosekliai, ne Promise.all: tas pats klientas tranzakcijoje gali vykdyti
    // tik po vieną užklausą.
    const pavadinimai = await zodynoId(klientas, "filesFilenames", "filename", eilutes.map((e) => e.pavadinimas));
    const pletiniai = await zodynoId(klientas, "filesExtensions", "extension", eilutes.map((e) => e.extension));
    const saltiniai = await zodynoId(klientas, "filesSourceTitles", "title", eilutes.map((e) => e.saltinis));
    const md5ai = await zodynoId(klientas, "filesMd5", "md5", eilutes.map((e) => e.md5));

    // Tėvai ir vaikai turi skirtingus unikalumo raktus, tad rašoma dviem sakiniais.
    const tevai = eilutes.filter((e) => e.parent == null);
    const vaikai = eilutes.filter((e) => e.parent != null);
    const ids = [];

    const stulpeliai = `(parent, "filenameId", "extensionId", "md5Id", filesize,
             "sourceTitleId", child, "sourceId0", "sourceId1", "sourceId2", "sourceId3",
             "downloadStatus")`;
    const reiksmes = (grupe) => [
        grupe.map((e) => e.parent),
        grupe.map((e) => pavadinimai.get(e.pavadinimas) ?? null),
        grupe.map((e) => pletiniai.get(e.extension) ?? null),
        grupe.map((e) => md5ai.get(e.md5) ?? null),
        grupe.map((e) => e.dydis),
        grupe.map((e) => saltiniai.get(e.saltinis) ?? null),
        grupe.map((e) => e.parent != null),
        grupe.map((e) => e.dalys[0]),
        grupe.map((e) => e.dalys[1]),
        grupe.map((e) => e.dalys[2]),
        grupe.map((e) => e.dalys[3]),
        grupe.map((e) => e.parsiustas),
    ];
    const unnest = `unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::bigint[],
                           $6::int[], $7::bool[], $8::text[], $9::text[], $10::text[],
                           $11::text[], $12::smallint[])`;

    if (tevai.length) {
        const { rows } = await klientas.query(
            `INSERT INTO public.files ${stulpeliai}
             SELECT * FROM ${unnest}
             ON CONFLICT ("sourceTitleId", "sourceId0", "sourceId1", "sourceId2", "sourceId3")
                 WHERE child = false DO NOTHING
             RETURNING id`,
            reiksmes(tevai),
        );
        ids.push(...rows.map((r) => r.id));
    }

    if (vaikai.length) {
        const { rows } = await klientas.query(
            `INSERT INTO public.files ${stulpeliai}
             SELECT * FROM ${unnest}
             ON CONFLICT (parent, "sourceId0") WHERE child = true DO NOTHING
             RETURNING id`,
            reiksmes(vaikai),
        );
        ids.push(...rows.map((r) => r.id));
    }

    // Eilę pildo kodas, ne trigeris. Ta pati sąlyga, kokia buvo senajame
    // failai_parsiuntimai_queue_sync: laukia (0) arba nepavyko (-1). Parsiųsti (1) ir
    // iš archyvo išskleisti (-5) į eilę nepatenka. Filtruojama pačioje užklausoje —
    // taip nereikia sieti grąžintų id su įvesties eilutėmis.
    if (ids.length) {
        const queued = await klientas.query(
            `INSERT INTO public."filesDownloadQueue" (id)
             SELECT f.id FROM public.files f
             WHERE f.id = ANY($1::int[]) AND f."downloadStatus" IN (0, -1)
             ON CONFLICT (id) DO NOTHING`,
            [ids],
        );
        // Su išoriniu transakcijos klientu commit'o čia nežinome, todėl tokio
        // kvietimo signalą po COMMIT turi paskelbti pats kvietėjas.
        if (klientas === postgres && queued.rowCount > 0) {
            signalWork(WORK_SIGNALS.FILES_DOWNLOAD_READY, {
                source: "irasytiFailus",
                count: queued.rowCount,
            });
        }
    }

    return ids;
}

/**
 * Įrašo failus į `files`. Dublikatai (pagal šaltinio arba archyvo raktą) tyliai
 * praleidžiami, tad kviečiantiesiems savo „ar jau yra" patikros nebūtina.
 *
 * @param {Array<Object>} eilutes - { saltinis?, saltinioId?, dokId?, fileId?,
 *                                    pavadinimas?, extension?, parent?, parsiustas?,
 *                                    md5?, dydis? }
 * @param {import("pg").ClientBase} [klientas] - tranzakcijos klientas, jei reikia
 * @returns {Promise<number[]>} naujai sukurtų failų id (esami negrąžinami)
 */
export async function irasytiFailus(eilutes, klientas = postgres) {
    if (!eilutes?.length) return [];

    return irasytiIFiles(klientas, eilutes.map(normalizuoti));
}
