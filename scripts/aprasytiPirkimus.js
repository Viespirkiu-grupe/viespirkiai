#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadEnvFile } from "../utils/configEnv.js";
import { parseArgs, positiveInteger } from "../utils/cliArgs.js";
import { postgres } from "../postgres/postgres.js";
import { FifoRateLimiter } from "../modules/openrouter/fifoRateLimiter.js";
import {
    eilesBusena,
    paimtiAprasymus,
    papildytiEileTrukstamais,
    pazymetiAprasymoRezultata,
} from "../modules/viesiejiPirkimai/aprasymuEile.js";
import {
    apiModel,
    getPaskirtis,
    getVariant,
    PASKIRTYS,
} from "../modules/openrouter/modelioVariantai.js";
import {
    aprasymoIrankiai,
    aprasytiPirkima,
} from "../modules/viesiejiPirkimai/aprasymoGeneravimas.js";
import {
    runAdaptiveSlots,
    runWithSlots,
} from "../modules/viesiejiPirkimai/runWithSlots.js";
import {
    kaina,
    sukurtiSuvestine,
    uzklausuZurnalas,
} from "../modules/viesiejiPirkimai/uzklausuZurnalas.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RPS = 12.5;
const MAX_AUTO_CONCURRENCY = 256;

function usage() {
    return [
        "Naudojimas: npm run pirkimai:aprasyti -- [parametrai]",
        "",
        "  --limit N          aprašyti daugiausia N pirkimų (numatyta: visą eilę)",
        "  --papildyti [N]    prieš pradedant įdėti į eilę dar neaprašytus pirkimus",
        "                     (naujausius pirmiau; be N – visus)",
        "  --rps N            OpenRouter užklausų per sekundę (numatyta: 12.5)",
        "  --concurrency N    fiksuotas darbų skaičius (numatyta: automatinis)",
        '  --variant N        naudoti esamą ai."modeliuVariantai".id (numatyta: pagal ai."paskirtys")',
        '  --force            aprašyti net kai ai."paskirtys".aktyvus = false',
        "  --log              loginti kiekvieną OpenRouter užklausą (dydžiai ir",
        "                     kaina, be turinio) – matyti, kur suka tokenus",
        "",
        "Sąskaita (užklausų skaičius, tokenai, kaina) rodoma visada, nepriklausomai",
        "nuo --log: pabaigoje ir kas sekundę progreso eilutėje.",
        "",
        "Darbas imamas IŠ `viesiejiPirkimaiAprasymaiQueue` – tos pačios eilės, kurią",
        "suka taskRunner'is, su ta pačia rezervacija (FOR UPDATE SKIP LOCKED), tais",
        "pačiais failų paruoštumo vartais ir tuo pačiu bandymų skaitikliu. Abu gali",
        "suktis vienu metu ir vienas kitam ant kojų neužlips.",
    ].join("\n");
}

function positiveNumber(value, option) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`${option} turi būti teigiamas skaičius`);
    }
    return number;
}

/*
Rezervuoja eilutes iš eilės tokiu tempu, kokiu jos apdorojamos.

`runWithSlots` traukia po vieną ir sustoja, kai slotai pilni, tad generatorius
niekada nelaiko rezervuotų daugiau nei vieną porciją į priekį. Tai svarbu: kritus
scriptui rezervacijos kabo iki `LOCK_TIMEOUT` (30 min.), tad jų nelaikom
atsargai.

Porcija imama pagal slotų kiekį – vienas `paimtiAprasymus` kreipinys su
`LIMIT 8` pigesnis nei aštuoni po vieną, o `FOR UPDATE SKIP LOCKED` reiškia, kad
lygiagretus taskRunner'is tiesiog pasiims kitas eilutes.
*/
async function* eilesPirkimai(variantId, limit, porcijosDydis) {
    let paimta = 0;
    while (paimta < limit) {
        const kiek = Math.min(porcijosDydis, limit - paimta);
        const porcija = await paimtiAprasymus(variantId, kiek);
        if (!porcija.length) return;
        for (const eilute of porcija) {
            yield eilute;
            paimta++;
        }
    }
}

function duration(seconds) {
    if (!Number.isFinite(seconds)) return "–";
    const rounded = Math.max(0, Math.round(seconds));
    if (rounded < 60) return `${rounded}s`;
    if (rounded < 3600) return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
    return `${Math.floor(rounded / 3600)}h ${Math.floor((rounded % 3600) / 60)}m`;
}

export async function main(argv = process.argv.slice(2)) {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(usage());
        return;
    }

    loadEnvFile(process.cwd());
    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error("Nenustatytas OPENROUTER_API_KEY.");
    }

    const args = parseArgs(argv);
    const limit = args.limit == null
        ? Infinity
        : positiveInteger(args.limit, "--limit");
    const concurrency = args.concurrency == null
        ? null
        : positiveInteger(args.concurrency, "--concurrency");
    const rps = args.rps == null
        ? DEFAULT_RPS
        : positiveNumber(args.rps, "--rps");
    const variantId = args.variant == null
        ? null
        : positiveInteger(args.variant, "--variant");
    /*
    Sąskaita kaupiama VISADA – `--log` tik įjungia eilutes po kiekvieną
    užklausą. Suvestinė nieko nekainuoja, o be jos masinis paleidimas vėl būtų
    „prasuko pinigus ir nesuprantu kur".
    */
    const logintiUzklausas = argv.includes("--log");
    const suvestine = sukurtiSuvestine();
    // Modelis imamas iš DB (`ai."paskirtys"`), nebent nurodytas `--variant`.
    // Ta pati vėliava, kuri stabdo eilę, stabdo ir šį backfill'ą — kad
    // sustabdytas darbas nepasileistų per rankinį paleidimą netyčia.
    const paskirtis = await getPaskirtis(PASKIRTYS.VIESUJU_PIRKIMU_APRASYMAS);
    if (!paskirtis.aktyvus && !args.force) {
        process.stderr.write(
            `Pirkimų aprašymas išjungtas (ai."paskirtys"."${paskirtis.paskirtis}".aktyvus = false).`
            + " Nieko nedaroma; priverstinai – su --force.\n",
        );
        return;
    }
    const variant = variantId ? await getVariant(variantId) : paskirtis.variant;
    const model = apiModel(variant);
    const tools = aprasymoIrankiai();
    const rateLimiter = new FifoRateLimiter(rps);
    const stats = { pradeta: 0, issaugota: 0, neaprasoma: 0, klaidos: 0, jauBuvo: 0 };

    if (args.papildyti) {
        const kiek = args.papildyti === true
            ? Infinity
            : positiveInteger(args.papildyti, "--papildyti");
        const prideta = await papildytiEileTrukstamais(variant.id, kiek);
        process.stderr.write(`Į eilę pridėta ${prideta} dar neaprašytų pirkimų.\n`);
    }

    /*
    Eilės ilgis NĖRA darbo kiekis: dalis eilučių laukia failų konvejerio, dalis
    atidėta po klaidos, dalis mirusi ties MAX_BANDYMAI. Rodom išskaidymą, kad
    „eilėje 130, o dirbti nėra ko" nebeatrodytų kaip gedimas.
    */
    const busena = await eilesBusena(variant.id);
    const total = Math.min(busena.laukia, limit);
    const startedAt = performance.now();
    let completed = 0;
    let activeJobs = 0;
    let currentConcurrency = concurrency ?? DEFAULT_CONCURRENCY;

    process.stderr.write(
        `Modelis: ${model} · variantas #${variant.id} · ${rps} RPS · `+
        `${concurrency == null ? `automatiniai slotai (pradžia ${DEFAULT_CONCURRENCY})` : `${concurrency} slotai`}`+
        ` · ${total} pirkimų${Number.isFinite(limit) ? ` · limitas ${limit}` : ""}\n`,
    );
    process.stderr.write(
        `Eilėje ${busena.viso}: ${busena.laukia} paruošta darbui`+
        ` · ${busena.failaiNeparuosti} laukia failų konvejerio`+
        ` · ${busena.atidetos} atidėtos po klaidos`+
        ` · ${busena.mirusios} mirusios (attempts riba)`+
        ` · ${busena.uzrakintos} rezervuotos kitų`+
        `${busena.jauAprasyti ? ` · ${busena.jauAprasyti} jau aprašyti (bus išvalyti)` : ""}\n\n`,
    );
    if (!total) {
        process.stderr.write(
            "Nėra ko dirbti. Jei eilėje dar yra eilučių, žr. skaidinį aukščiau –"
            + " mirusias atlaisvina tik rankinis attempts nulinimas.\n",
        );
        return;
    }
    const rows = eilesPirkimai(variant.id, limit, concurrency ?? DEFAULT_CONCURRENCY);

    const progressLine = () => {
        const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
        const pps = completed / elapsedSeconds;
        const eta = pps > 0 ? (total - completed) / pps : Infinity;
        const percent = total ? completed / total * 100 : 100;
        const queuePercent = currentConcurrency
            ? rateLimiter.waitingCount / currentConcurrency * 100
            : 0;
        process.stderr.write(
            `… ${completed}/${total} (${percent.toFixed(1)}%) · ${pps.toFixed(2)} PPS`+
            ` · ${rateLimiter.averageRps.toFixed(1)}/${rps} RPS`+
            ` · ${activeJobs}/${currentConcurrency} darbai`+
            ` · ${rateLimiter.waitingCount} užklausų eilėje (${queuePercent.toFixed(0)}%)`+
            ` · ETA ${duration(eta)}`+
            ` · ${suvestine.viso.uzklausu} užkl. ${kaina(suvestine.viso.kaina)}\n`,
        );
    };
    /*
    Su `--log` periodinės progreso eilutės nerodomos: tą patį (ir tiksliau)
    pasako pačios užklausų eilutės, o įsiterpdamos kas sekundę jos tik ardo
    vieno pirkimo seką. Be `--log` progreso eilutė lieka vienintelis gyvybės
    ženklas, tad ten ji būtina.
    */
    const progressTimer = logintiUzklausas
        ? null
        : setInterval(progressLine, 1000);

    const logCompleted = (pirkimoId, symbol, outcome) => {
        completed++;
        process.stderr.write(`${symbol} #${pirkimoId} ${outcome}\n`);
    };

    const describePurchase = async ({ pirkimoId }) => {
        stats.pradeta++;
        activeJobs++;
        let symbol = "✓";
        let outcome = "išsaugota";
        // Kiekvienas pirkimas turi savo žurnalą (žymė eilutėse – nes lygiagretūs
        // darbai rašo į tą patį srautą), bet sąskaita bendra.
        const { onEvent, savi } = uzklausuZurnalas({
            zyme: pirkimoId,
            tylus: !logintiUzklausas,
            suvestine,
        });
        try {
            const rezultatas = await aprasytiPirkima({
                pirkimoId,
                variant,
                model,
                tools,
                apiKey: process.env.OPENROUTER_API_KEY,
                beforeRequest: () => rateLimiter.acquire(),
                onEvent,
            });
            stats[rezultatas]++;
            if (rezultatas === "neaprasoma") {
                symbol = "○";
                outcome = "nepakanka duomenų";
            } else if (rezultatas === "jauBuvo") {
                symbol = "○";
                outcome = "jau buvo";
            }
            // Sėkmė ir „nepakanka duomenų" – galutiniai atsakymai: eilutė iš
            // eilės dingsta. Būtent to trūko, kai šis scriptas dirbo su savo
            // atskiru sąrašu ir eilė nuo jo darbo netrumpėjo.
            await pazymetiAprasymoRezultata(pirkimoId, null);
        } catch (error) {
            stats.klaidos++;
            symbol = "✗";
            outcome = `klaida: ${error.message.replace(/\s+/g, " ").slice(0, 160)}`;
            // Aplinkos klaida bandymų nedegina – tik atideda (žr. aprasymuEile.js).
            await pazymetiAprasymoRezultata(pirkimoId, error);
        } finally {
            logCompleted(
                pirkimoId,
                symbol,
                `${outcome} · ${savi.uzklausu} užkl. · ${kaina(savi.kaina)}`,
            );
            activeJobs--;
        }
    };

    try {
        if (concurrency == null) {
            await runAdaptiveSlots(rows, describePurchase, {
                initialConcurrency: DEFAULT_CONCURRENCY,
                maxConcurrency: MAX_AUTO_CONCURRENCY,
                canGrow: () => rateLimiter.waitingCount <= currentConcurrency * 0.5,
                onConcurrencyChange: (value) => { currentConcurrency = value; },
            });
        } else {
            await runWithSlots(rows, describePurchase, concurrency);
        }
    } finally {
        if (progressTimer) clearInterval(progressTimer);
    }

    if (!logintiUzklausas) progressLine();

    process.stderr.write(
        `\nBaigta · ${stats.issaugota} išsaugota · ${stats.klaidos} klaidų`+
        `${stats.neaprasoma ? ` · ${stats.neaprasoma} neaprašomi` : ""}`+
        `${stats.jauBuvo ? ` · ${stats.jauBuvo} jau buvo` : ""}\n`,
    );
    process.stderr.write(`Sąskaita · ${suvestine.eilute()}\n`);
    const pabaiga = await eilesBusena(variant.id);
    process.stderr.write(
        `Eilėje liko ${pabaiga.viso} (${pabaiga.laukia} paruošta darbui`+
        ` · ${pabaiga.failaiNeparuosti} laukia failų`+
        ` · ${pabaiga.atidetos} atidėtos · ${pabaiga.mirusios} mirusios)\n`,
    );
    if (stats.issaugota) {
        process.stderr.write(
            `Vidutiniškai vienam aprašymui:`
            + ` ${kaina(suvestine.viso.kaina / stats.issaugota)}`
            + ` · ${Math.round(suvestine.viso.uzklausu / stats.issaugota)} užklausos\n`,
        );
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        })
        .finally(() => postgres.end());
}
