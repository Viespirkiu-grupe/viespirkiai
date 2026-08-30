// Dviejų teisės akto suvestinių redakcijų palyginimas iš komandinės eilutės.
//
// Redakcija nurodoma DATA, ne tokenu: iš "eTar"."edition" (arba "eSeimas"."edition")
// randam, kuri redakcija tą dieną galiojo, o tekstą — iš sidecar'o pagal
// "eTar"."legalActDocument"."md5".
//
// Paleisti:  npm run teisekura:palyginti -- TAR.XXXX 2020-01-01 2024-01-01
//            npm run teisekura:palyginti -- TAR.XXXX     (redakcijas renkiesi sąraše)

import { pathToFileURL } from "node:url";
import { createTwoFilesPatch } from "diff";
import { postgres } from "../../postgres/postgres.js";
import { writeWithPager } from "../../utils/pager.js";
import { pasirinktiRedakcijas } from "./pasirinktiRedakcijas.js";
import { indexStructure, normalizeLegalActText } from "../mcp/tools/teisesAktoTurinys.js";
import {
    daliesEilutes,
    ikeltiRedakcija,
    lenteliuPriesagas,
    palygintiStruktura,
    redakcijaPagalData,
    redakcijuSarasas,
    suskaiciuoti,
} from "./redakcijuSkirtumai.js";

export const HELP = `Naudojimas:
  npm run teisekura:palyginti -- TEISĖS_AKTO_ID [DATA1 DATA2] [parinktys]

Datos formatu YYYY-MM-DD; parenkama tą dieną galiojusi suvestinė redakcija.
Be datų terminale atveriamas redakcijų sąrašas – rodyklėmis pasirenkamos dvi.

Parinktys:
      --redakcijos  Tik parodyti akto redakcijų sąrašą (datų nereikia)
      --unified     Vietoj palyginimo pagal struktūros dalis – unified diff
      --part ID     Rodyti tik šios dalies (ir jos poskyrių) skirtumus
      --context N   Konteksto eilutės unified režime (numatyta: 3)
      --json        Išvesti skirtumus kaip JSON
      --[no-]color  Priverstinai įjungti arba išjungti spalvas
      --[no-]pager  Įjungti arba išjungti interaktyvų puslapiavimą
  -h, --help        Parodyti šią pagalbą`;

const ANSI = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
};

function paint(text, color, enabled) {
    return enabled && ANSI[color] ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseArgs(argv) {
    const options = {
        teisesAktoId: null,
        datos: [],
        unified: false,
        redakcijos: false,
        partId: null,
        context: 3,
        json: false,
        color: null,
        pager: true,
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "-h" || arg === "--help") options.help = true;
        else if (arg === "--unified") options.unified = true;
        else if (arg === "--redakcijos") options.redakcijos = true;
        else if (arg === "--json") options.json = true;
        else if (arg === "--color") options.color = true;
        else if (arg === "--no-color") options.color = false;
        else if (arg === "--pager") options.pager = true;
        else if (arg === "--no-pager") options.pager = false;
        else if (arg === "--part") options.partId = argv[++i] ?? null;
        else if (arg === "--context") options.context = Number(argv[++i]);
        else if (arg.startsWith("-")) throw new Error(`Nežinoma parinktis: ${arg}`);
        else if (DATE_RE.test(arg)) options.datos.push(arg);
        else if (options.teisesAktoId === null) options.teisesAktoId = arg;
        else throw new Error(`Nesuprantamas argumentas: ${arg}`);
    }
    if (!Number.isInteger(options.context) || options.context < 0) {
        throw new Error("--context turi būti neneigiamas sveikas skaičius");
    }
    return options;
}

function formatuotiRedakcijas(rows, color) {
    return rows
        .map((r) => {
            const zyme = r.turiTeksta ? "✓" : "×";
            const eilute = `  ${zyme} ${r.nuo} – ${r.iki ?? "…"}  ${r.editionToken}`;
            return r.turiTeksta ? eilute : paint(`${eilute}  (teksto neturime)`, "dim", color);
        })
        .join("\n");
}

/** Vienos dalies skirtumai tekstu: [-išbraukta-] / {+pridėta+}. */
export function daliesSkirtumai(pries, po, color = false) {
    return daliesEilutes(pries, po)
        .map((eilute) => {
            if (eilute.tipas === "pakeista") {
                return eilute.segmentai
                    .map((s) => {
                        if (s.tipas === "pridėta") return paint(`{+${s.tekstas}+}`, "green", color);
                        if (s.tipas === "pašalinta") return paint(`[-${s.tekstas}-]`, "red", color);
                        return s.tekstas;
                    })
                    .join("");
            }
            const zenklas = eilute.tipas === "pridėta" ? "+" : "-";
            const spalva = eilute.tipas === "pridėta" ? "green" : "red";
            return paint(`${zenklas} ${eilute.tekstas}`, spalva, color);
        })
        .join("\n");
}

function filtruoti(pakeitimai, partId, indexA, indexB) {
    const node = indexB.ordered.find((i) => i.id === partId)
        ?? indexA.ordered.find((i) => i.id === partId);
    if (!node) throw new Error(`Dalis ${partId} nerasta nė vienoje redakcijoje.`);
    const prefix = node.path.join(" › ");
    return pakeitimai.filter(
        (p) => p.kelias === prefix || p.kelias.startsWith(`${prefix} › `),
    );
}

function antraste(pavadinimas, a, b, color) {
    const eilutes = [paint(pavadinimas ?? "(be pavadinimo)", "bold", color)];
    for (const [zyme, r] of [["A", a], ["B", b]]) {
        const laikotarpis = r.nuo || r.iki ? `${r.nuo ?? "…"} – ${r.iki ?? "…"}` : "be datų";
        eilutes.push(paint(`  ${zyme} ${r.data}: ${r.versijosId} (${laikotarpis})`, "dim", color));
    }
    return eilutes.join("\n");
}

function trumpinti(text, ilgis) {
    const vienoje = text.replace(/\s+/g, " ").trim();
    return vienoje.length > ilgis ? `${vienoje.slice(0, ilgis - 1)}…` : vienoje;
}

/** Ilgi keliai netelpa į ekraną – rodom tik paskutines pakopas. */
function trumpasKelias(kelias, pavadinimas) {
    const pakopos = kelias.split(" › ").slice(0, -1);
    if (!pakopos.length) return null;
    const uodega = pakopos.slice(-2).map((p) => trumpinti(p, 50)).join(" › ");
    const trumpas = pakopos.length > 2 ? `… › ${uodega}` : uodega;
    return trumpas === trumpinti(pavadinimas, 50) ? null : trumpas;
}

export function formatuoti(pakeitimai, color) {
    const blokai = [];
    for (const p of pakeitimai) {
        const kelias = trumpasKelias(p.kelias, p.pavadinimas);
        const header = paint(`@@ ${trumpinti(p.pavadinimas, 100)} — ${p.pokytis} @@`, "cyan", color)
            + (kelias ? `\n${paint(kelias, "dim", color)}` : "");
        if (p.pokytis === "pakeista") {
            blokai.push(`${header}\n${daliesSkirtumai(p.pries, p.po, color)}`);
        } else if (p.pokytis === "pridėta") {
            blokai.push(`${header}\n${paint(p.po, "green", color)}`);
        } else {
            blokai.push(`${header}\n${paint(p.pries, "red", color)}`);
        }
    }
    return blokai.join("\n\n");
}

function formatuotiUnified(patch, color) {
    if (!color) return patch;
    return patch
        .split("\n")
        .map((line) => {
            if (line.startsWith("@@")) return paint(line, "cyan", true);
            if (line.startsWith("+")) return paint(line, "green", true);
            if (line.startsWith("-")) return paint(line, "red", true);
            return line;
        })
        .join("\n");
}

/** Sukamas brūkšnelis, kol kraunamos redakcijos – tekstas ateina ne akimirksniu. */
async function suLoaderiu(tekstas, darbas, output = process.stdout) {
    if (!output.isTTY) return darbas();
    const kadrai = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    output.write(`${kadrai[0]} ${tekstas}`);
    const laikmatis = setInterval(() => {
        i = (i + 1) % kadrai.length;
        output.write(`\r${kadrai[i]} ${tekstas}`);
    }, 90);
    try {
        return await darbas();
    } finally {
        clearInterval(laikmatis);
        output.write("\r\x1b[2K");
    }
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;

function regimasIlgis(text) {
    return text.replace(ANSI_RE, "").length;
}

/**
 * Laužo eilutes pagal terminalo plotį. Be to `utils/pager.js` puslapį skaičiuoja
 * loginėmis eilutėmis, o straipsnio pastraipa terminale užima kelias – pirmas
 * puslapis išbėgdavo už ekrano.
 */
export function lauzyti(text, plotis) {
    if (!plotis || plotis < 20) return text;
    const out = [];
    for (const line of text.split("\n")) {
        if (regimasIlgis(line) <= plotis) {
            out.push(line);
            continue;
        }
        let dabartine = "";
        let ilgis = 0;
        for (const zodis of line.split(" ")) {
            const w = regimasIlgis(zodis);
            if (ilgis && ilgis + 1 + w > plotis) {
                out.push(dabartine);
                dabartine = zodis;
                ilgis = w;
            } else {
                dabartine = ilgis ? `${dabartine} ${zodis}` : zodis;
                ilgis = ilgis ? ilgis + 1 + w : w;
            }
        }
        out.push(dabartine);
    }
    return out.join("\n");
}

/** Data → redakcija; kai tokios nėra, parodom, kokias turim. */
async function rastiRedakcija(teisesAktoId, data, db) {
    const rows = await redakcijuSarasas(teisesAktoId, db);
    const redakcija = redakcijaPagalData(rows, data);
    if (redakcija) return redakcija;
    throw new Error(
        `${teisesAktoId}: ${data} dieną galiojusios redakcijos nerasta. Turimos:\n`
        + formatuotiRedakcijas(rows, false),
    );
}

/** Redakcijos tekstas; be teksto – klaida su tuo, ką palyginti galima. */
async function ikelti(teisesAktoId, redakcija, priesaga, db) {
    const ikelta = await ikeltiRedakcija(teisesAktoId, redakcija.versijosId, priesaga, db);
    if (ikelta.ok) return ikelta;

    const laikotarpis = redakcija.nuo || redakcija.iki
        ? ` (${redakcija.nuo ?? "…"} – ${redakcija.iki ?? "…"})`
        : "";
    const turincios = (await redakcijuSarasas(teisesAktoId, db)).filter((r) => r.turiTeksta);
    throw new Error(
        `Redakcijos ${redakcija.versijosId}${laikotarpis} teksto neturime`
        + `${ikelta.priezastis ? `: ${ikelta.priezastis}` : ""}.`
        + (turincios.length
            ? `\nTekstą turim šioms redakcijoms:\n${formatuotiRedakcijas(turincios, false)}`
            : " Šio akto redakcijų tekstų dar neturim."),
    );
}

export async function main(argv = process.argv.slice(2), db = postgres) {
    const options = parseArgs(argv);
    if (options.help || !options.teisesAktoId) {
        console.log(HELP);
        return;
    }
    const color0 = options.color ?? (process.stdout.isTTY === true);
    if (options.redakcijos) {
        const rows = await redakcijuSarasas(options.teisesAktoId, db);
        if (options.json) {
            process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
            return;
        }
        process.stdout.write(
            rows.length
                ? `${formatuotiRedakcijas(rows, color0)}\n`
                : `${options.teisesAktoId}: redakcijų sąrašo neturime.\n`,
        );
        return;
    }
    const color = color0;
    let redakcijaA;
    let redakcijaB;
    let data1;
    let data2;

    if (options.datos.length === 0) {
        const rows = await redakcijuSarasas(options.teisesAktoId, db);
        if (!rows.length) throw new Error(`${options.teisesAktoId}: redakcijų sąrašo neturime.`);
        const pasirinktos = await pasirinktiRedakcijas(rows);
        if (!pasirinktos) return;
        [redakcijaA, redakcijaB] = pasirinktos.map((r) => ({
            versijosId: r.editionToken,
            nuo: r.nuo,
            iki: r.iki,
            url: r.url,
            data: r.nuo,
        }));
        data1 = redakcijaA.nuo;
        data2 = redakcijaB.nuo;
    } else if (options.datos.length === 2) {
        [data1, data2] = [...options.datos].sort();
        redakcijaA = await rastiRedakcija(options.teisesAktoId, data1, db);
        redakcijaB = await rastiRedakcija(options.teisesAktoId, data2, db);
    } else {
        throw new Error("Nurodyk dvi datas formatu YYYY-MM-DD arba nė vienos – tada rinksies sąraše.");
    }

    if (redakcijaA.versijosId === redakcijaB.versijosId) {
        process.stdout.write(
            `${data1} ir ${data2} galiojo ta pati redakcija (${redakcijaA.versijosId}) — pakeitimų nėra.\n`,
        );
        return;
    }

    const priesaga = await lenteliuPriesagas(options.teisesAktoId, db);
    const [a, b] = await suLoaderiu(
        `Kraunamos redakcijos ${redakcijaA.versijosId} ir ${redakcijaB.versijosId}…`,
        () => Promise.all([
            ikelti(options.teisesAktoId, redakcijaA, priesaga, db),
            ikelti(options.teisesAktoId, redakcijaB, priesaga, db),
        ]),
    );
    const pavadinimas = b.pavadinimas ?? a.pavadinimas;
    const beStrukturos = !a.structure.length || !b.structure.length;

    if (options.unified || beStrukturos) {
        let tekstasA = a.text;
        let tekstasB = b.text;
        if (options.partId) {
            const indexA = a.index ?? indexStructure(a.structure);
            const indexB = b.index ?? indexStructure(b.structure);
            const nodeA = indexA.byId.get(options.partId);
            const nodeB = indexB.byId.get(options.partId);
            if (!nodeA && !nodeB) throw new Error(`Dalis ${options.partId} nerasta.`);
            tekstasA = normalizeLegalActText(nodeA?.text);
            tekstasB = normalizeLegalActText(nodeB?.text);
        }
        const patch = createTwoFilesPatch(
            `${redakcijaA.versijosId} (${data1})`,
            `${redakcijaB.versijosId} (${data2})`,
            tekstasA,
            tekstasB,
            "",
            "",
            { context: options.context },
        );
        if (options.json) {
            process.stdout.write(`${JSON.stringify({ redakcijaA, redakcijaB, patch }, null, 2)}\n`);
            return;
        }
        if (beStrukturos && !options.unified) {
            process.stdout.write(
                "Bent viena redakcija neturi struktūros – rodomas unified diff.\n\n",
            );
        }
        await writeWithPager(
            lauzyti(
                `${antraste(pavadinimas, redakcijaA, redakcijaB, color)}\n\n${formatuotiUnified(patch, color)}`,
                process.stdout.columns,
            ),
            { enabled: options.pager },
        );
        return;
    }

    let pakeitimai = palygintiStruktura(a.index, b.index);
    if (options.partId) pakeitimai = filtruoti(pakeitimai, options.partId, a.index, b.index);

    if (options.json) {
        process.stdout.write(
            `${JSON.stringify({ teisesAktoId: options.teisesAktoId, pavadinimas, redakcijaA, redakcijaB, suvestine: suskaiciuoti(pakeitimai), pakeitimai }, null, 2)}\n`,
        );
        return;
    }

    const suvestine = suskaiciuoti(pakeitimai);
    const santrauka = `  pakeista: ${suvestine.pakeista}, pridėta: ${suvestine.pridėta}, pašalinta: ${suvestine.pašalinta}`;
    if (!pakeitimai.length) {
        process.stdout.write(`${antraste(pavadinimas, redakcijaA, redakcijaB, color)}\n\nTekstų skirtumų nerasta.\n`);
        return;
    }
    await writeWithPager(
        lauzyti(
            [
                antraste(pavadinimas, redakcijaA, redakcijaB, color),
                paint(santrauka, "dim", color),
                "",
                formatuoti(pakeitimai, color),
            ].join("\n"),
            process.stdout.columns,
        ),
        { enabled: options.pager },
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
        .catch((error) => {
            console.error(`Nepavyko palyginti redakcijų: ${error.message}`);
            process.exitCode = 1;
        })
        .finally(async () => {
            await postgres.end();
        });
}
