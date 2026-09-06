import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("ppa", { operation: "parse" });
import config from "../../utils/config.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import XLSX from "xlsx";
import { postgres } from "../../postgres/postgres.js";

// ── helpers ──────────────────────────────────────────────────────────────────
function phone(v) {
    if (v == null) return null;
    // raw: false may render large integers as "37,065,497,671" — strip commas first
    const digits = String(v).replace(/,/g, "").trim();
    if (!/^\d+$/.test(digits)) return digits; // already has + or letters, return as-is
    // Lithuanian numbers start with 370; international format
    if (digits.startsWith("370")) return `+${digits}`;
    // fallback: just prefix +
    return `+${digits}`;
}

function cell(r, idx) {
    if (!r) return null;
    const v = r[idx];
    return v === "" || v === undefined ? null : v;
}

function str(v) {
    return v != null
        ? String(v)
              .trim()
              .replace(/[\r\n]+/g, " ")
        : null;
}
function bool(v) {
    return v === "Taip" ? true : v === "Ne" ? false : null;
}
export function normalizePpaNumber(v) {
    if (v == null || v === "") return null;
    const value = Number(v);
    return Number.isFinite(value) ? value : null;
}
const num = normalizePpaNumber;
function validIsoDate(year, month, day) {
    const value = new Date(Date.UTC(year, month - 1, day));
    return value.getUTCFullYear() === year
        && value.getUTCMonth() === month - 1
        && value.getUTCDate() === day;
}

export function normalizePpaDate(v) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
        // SheetJS Date objektą sukuria XLSX kalendorinės dienos vietos laiku,
        // todėl naudojame vietinius komponentus (UTC data Vilniuje būtų diena anksčiau).
        const year = v.getFullYear();
        const month = v.getMonth() + 1;
        const day = v.getDate();
        return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    if (typeof v === "number" && Number.isFinite(v)) {
        // Kai datos langeliui paliktas „General“ formatas, SheetJS jo nepaverčia
        // į Date net su cellDates=true ir grąžina Excel serijos numerį.
        const parsed = XLSX.SSF.parse_date_code(v);
        if (parsed && validIsoDate(parsed.y, parsed.m, parsed.d)) {
            return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
        }
        throw new Error(`PPA parse error: invalid date "${v}"`);
    }

    let value = str(v);
    if (value == null) return null;
    if (/^[-–—]+$/.test(value)) return null;
    // Išnašos žymė prie datos, pvz. „2026-04-29*“.
    value = value.replace(/\*+$/, "").trim();
    // Pasitaikęs praleistas skaitmuo: „206-04-03“ šalia kitų 2026 m. datų.
    value = value.replace(/^20(\d)(?=[/.\-\s])/, "202$1");

    let year;
    let month;
    let day;
    let match = value.match(/^(\d{4})[/.\-\s](\d{1,2})[/.\-\s](\d{1,2})$/);
    if (match) {
        [, year, month, day] = match.map(Number);
    } else {
        match = value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
        if (match) {
            day = Number(match[1]);
            month = Number(match[2]);
            year = Number(match[3]);
        } else {
            // Tikro XLSX datos langelio čia neturėtų likti: jį gauname kaip Date.
            // Tekstinei trumpai datai tvarką nustatome tik kai ji vienareikšmė.
            match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
            if (!match) throw new Error(`PPA parse error: invalid date "${value}"`);
            const first = Number(match[1]);
            const second = Number(match[2]);
            if (first > 12 && second <= 12) {
                day = first;
                month = second;
            } else if (second > 12 && first <= 12) {
                month = first;
                day = second;
            } else {
                throw new Error(`PPA parse error: ambiguous date "${value}"`);
            }
            year = 2_000 + Number(match[3]);
        }
    }

    if (!validIsoDate(year, month, day)) {
        throw new Error(`PPA parse error: invalid date "${value}"`);
    }
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function date(v) {
    return normalizePpaDate(v);
}

function dateOrText(v) {
    if (v == null) return null;
    if (v instanceof Date || typeof v === "number") return date(v);
    const value = str(v);
    if (value == null || /^[-–—]+$/.test(value)) return null;
    if (/^\d{3,4}[/.\-\s]\d{1,2}[/.\-\s]\d{1,2}\**$/.test(value)) {
        return date(value);
    }
    return value;
}

function contractValidity(v) {
    const parsed = dateOrText(v);
    if (parsed == null) return { date: null, note: null };
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
        try {
            return { date: date(parsed), note: null };
        } catch {
            return { date: null, note: String(parsed) };
        }
    }
    const short = String(parsed).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (short) {
        const iso = `${2000 + Number(short[3])}-${String(Number(short[1])).padStart(2, "0")}-${String(Number(short[2])).padStart(2, "0")}`;
        try {
            return { date: date(iso), note: null };
        } catch {}
    }
    return { date: null, note: String(parsed) };
}

export function normalizePpaSheetName(name) {
    const normalized = String(name ?? "")
        .trim()
        .replace(/\s+/g, " ")
        // Šablonai naudoja skirtingus brūkšnius ir nevienodai deda taškus:
        // „I.–III.“ / „I–III“, „III.5“ / „III.-5“ / „III-5“.
        .replace(/[‐‑‒–—]/g, "-")
        // Pasitaiko „V.VI.2“ vietoje „V.–VI.2“.
        .replace(/([IVXLCDM])\.(?=[IVXLCDM])/gi, "$1-")
        .replace(/\./g, "")
        .replace(/-(?=\d)/g, "");
    // Pasitaikanti „V.–V.-2“ rašybos klaida (antras skyrius turi būti VI).
    return normalized === "V-V2" ? "V-VI2" : normalized;
}

export function findPpaSheet(wb, name) {
    const expected = normalizePpaSheetName(name);
    const found = wb.SheetNames.find(
        (sheetName) => normalizePpaSheetName(sheetName) === expected,
    );
    if (found) return wb.Sheets[found];

    // Excel kopijuotoms kortelėms automatiškai prideda „ (1)“, „ (2)“ ir t. t.
    // Jei originalios kortelės nebėra, naudojame didžiausio numerio kopiją.
    const escapedExpected = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const copyPattern = new RegExp(`^${escapedExpected}\\s*\\((\\d+)\\)$`);
    const copies = wb.SheetNames
        .map((sheetName) => {
            const match = normalizePpaSheetName(sheetName).match(copyPattern);
            return match ? { sheetName, copy: Number(match[1]) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.copy - a.copy);
    if (copies.length) return wb.Sheets[copies[0].sheetName];

    // Vartotojas gali visiškai pervadinti kortelę (pvz., VII.3 į „11“).
    // Tokiu atveju atpažįstame ją pagal skyriaus antraštę pirmose eilutėse.
    const expectedHeading = expected.toLocaleUpperCase("lt-LT");
    for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet?.["!ref"]) continue;
        const headings = XLSX.utils
            .sheet_to_json(sheet, { header: 1, defval: null, raw: false })
            .slice(0, 3)
            .flat()
            .filter((value) => typeof value === "string");
        const matches = headings.some((heading) => {
            const normalized = normalizePpaSheetName(heading)
                .toLocaleUpperCase("lt-LT");
            return normalized === expectedHeading
                || normalized.startsWith(expectedHeading + " ");
        });
        if (matches) return sheet;
    }
    return null;
}

function assertSheet(wb, name) {
    const sheet = findPpaSheet(wb, name);
    if (!sheet) throw new Error(`PPA parse error: expected sheet "${name}"`);
    return sheet;
}

function toRows(sheet, raw = false) {
    return XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw,
        dateNF: "yyyy/mm/dd",
    });
}

// ── sheet parsers ─────────────────────────────────────────────────────────────

function parseI_III(wb) {
    const sheet = findPpaSheet(wb, "I.–III.");
    if (!sheet) return parseI_II(wb);
    const rows = toRows(sheet);
    // header row is row 5 (idx 5), data row is idx 6
    const d = rows[6];
    if (!d) throw new Error("PPA parse error: I.–III. missing data row");
    return {
        teisinisPagrindas: str(cell(d, 0)),
        ataskaitosTipas: str(cell(d, 1)),
        pirkimoNumeris: str(cell(d, 2)),
        pirkimoObjektoPavadinimas: str(cell(d, 3)),
        pirkimoVerte: str(cell(d, 4)),
        finansuojamasEsLesomis: bool(cell(d, 5)),
        sfmisRegistruotas: bool(cell(d, 6)),
        sfmisProjektoKodasIrPav: str(cell(d, 7)),
        elektroninisPirkimas: bool(cell(d, 8)),
        neElektroninisPriežastys: str(cell(d, 9)),
        perkanciosiosOrganizacijosKodas: str(cell(d, 10)),
        perkanciosiosOrganizacijosPavadinimas: str(cell(d, 11)),
        perkanciosiosOrganizacijosAdresas: str(cell(d, 12)),
        perkanciosiosOrganizacijosTipas: str(cell(d, 13)),
        kitaInformacija: str(cell(d, 14)),
        igaliojimasKitaiPO: bool(cell(d, 15)),
        igaliotosiosKodas: str(cell(d, 16)),
        igaliotosiosPavadinimas: str(cell(d, 17)),
        igaliotosiosAdresas: str(cell(d, 18)),
        igaliotosiosTipas: str(cell(d, 19)),
        igaliotosiosKitaInformacija: str(cell(d, 20)),
        preliminariSutartis: bool(cell(d, 21)),
        dinamineSistema: bool(cell(d, 22)),
        pirkimoObjektoRusis: str(cell(d, 23)),
        pagrindinisKodasBvpz: str(cell(d, 24)),
        papildomiKodaiBvpz: str(cell(d, 25)),
        daliuSkaicius: num(cell(d, 26)),
    };
}

function parseI_II(wb) {
    const sheet = assertSheet(wb, "I.–II.");
    const rows = toRows(sheet);
    // DPS šablone antraštė yra idx 4, duomenys idx 5. Jame nėra įprasto
    // III skyriaus laukų, o idx 3 yra atskiras procedūros numeris.
    const d = rows[5];
    if (!d) throw new Error("PPA parse error: I.–II. missing data row");
    const ataskaitosTipas = str(cell(d, 1));
    const normalizedType = ataskaitosTipas?.toLocaleLowerCase("lt-LT") ?? "";
    return {
        teisinisPagrindas: str(cell(d, 0)),
        ataskaitosTipas,
        pirkimoNumeris: str(cell(d, 2)),
        pirkimoObjektoPavadinimas: str(cell(d, 4)),
        pirkimoVerte: null,
        finansuojamasEsLesomis: bool(cell(d, 5)),
        sfmisRegistruotas: bool(cell(d, 6)),
        sfmisProjektoKodasIrPav: str(cell(d, 7)),
        elektroninisPirkimas: bool(cell(d, 8)),
        neElektroninisPriežastys: str(cell(d, 9)),
        perkanciosiosOrganizacijosKodas: str(cell(d, 10)),
        perkanciosiosOrganizacijosPavadinimas: str(cell(d, 11)),
        perkanciosiosOrganizacijosAdresas: str(cell(d, 12)),
        perkanciosiosOrganizacijosTipas: str(cell(d, 13)),
        kitaInformacija: str(cell(d, 14)),
        igaliojimasKitaiPO: bool(cell(d, 15)),
        igaliotosiosKodas: str(cell(d, 16)),
        igaliotosiosPavadinimas: str(cell(d, 17)),
        igaliotosiosAdresas: str(cell(d, 18)),
        igaliotosiosTipas: str(cell(d, 19)),
        igaliotosiosKitaInformacija: str(cell(d, 20)),
        preliminariSutartis: normalizedType.includes("preliminariosios sutarties"),
        dinamineSistema: normalizedType.includes("dinaminės pirkimų sistemos"),
        pirkimoObjektoRusis: null,
        pagrindinisKodasBvpz: null,
        papildomiKodaiBvpz: null,
        daliuSkaicius: null,
    };
}

function parseIII5(wb) {
    const sheet = findPpaSheet(wb, "III.5");
    if (!sheet) return [];
    const rows = toRows(sheet);
    // header at idx 2, data starts at idx 3
    return rows
        .slice(3)
        .filter((r) => r && r.some((v) => v != null))
        .map((d) => ({
            daliesNumeris: num(cell(d, 0)),
            daliesPavadinimas: str(cell(d, 1)),
            pagrindinisKodasBvpz: str(cell(d, 2)),
            papildomiKodaiBvpz: str(cell(d, 3)),
        }));
}

function parseV_VI2(wb) {
    const sheet = findPpaSheet(wb, "V.–VI.2");
    if (!sheet) return parseV(wb);
    const rows = toRows(sheet);
    const d = rows[5];
    if (!d) throw new Error("PPA parse error: V.–VI.2 missing data row");
    return {
        pirkimoBudas: str(cell(d, 0)),
        pirkimoBudoPagrindimas: str(cell(d, 1)),
        ankstesnioNumeris: str(cell(d, 2)),
        pajamosReikalavimas: bool(cell(d, 3)),
        pajamosReikalavimasPriezastys: str(cell(d, 4)),
    };
}

function parseV(wb) {
    const sheet = assertSheet(wb, "V.");
    const rows = toRows(sheet);
    const d = rows[3];
    if (!d) throw new Error("PPA parse error: V. missing data row");
    return {
        pirkimoBudas: str(cell(d, 0)),
        pirkimoBudoPagrindimas: str(cell(d, 1)),
        ankstesnioNumeris: str(cell(d, 2)),
        pajamosReikalavimas: null,
        pajamosReikalavimasPriezastys: null,
    };
}

function parseVI(wb) {
    const sheet = findPpaSheet(wb, " VI.");
    if (!sheet) return [];
    const rows = toRows(sheet);
    // header at idx 2, data starts at idx 3
    return rows
        .slice(3)
        .filter((r) => r && r.some((v) => v != null))
        .map((d) => ({
            fizinisAsmuo: bool(cell(d, 0)),
            kodas: str(cell(d, 1)),
            pavadinimas: str(cell(d, 2)),
            pavadinimoPatikslinimas: str(cell(d, 3)),
            adresas: str(cell(d, 4)),
            salis: str(cell(d, 5)),
            grupe: str(cell(d, 6)),
            pasirinkimoPriezastis: str(cell(d, 7)),
        }));
}

function parseVII1(wb) {
    const sheet = findPpaSheet(wb, "VII.1");
    if (!sheet) return [];
    const rows = toRows(sheet);
    // header at idx 2, data starts at idx 3
    return rows
        .slice(3)
        .filter((r) => r && r.some((v) => v != null))
        .map((d) => ({
            daliesNumeris: str(cell(d, 0)),
            vertinimoKriterijus: str(cell(d, 1)),
        }));
}

function parseVII2(wb) {
    const sheet = assertSheet(wb, "VII.2");
    const rows = toRows(sheet);
    return rows
        .slice(3)
        .filter((r) => r && r.some((v) => v != null))
        .map((d) => ({
            daliesNumeris: num(cell(d, 0)),
            dalyvioKodas: str(cell(d, 1)),
            dalyvioPavadinimas: str(cell(d, 2)),
            statusas: str(cell(d, 3)),
            nepakviestoPriezastys: str(cell(d, 4)),
            atsiemimoPriezastys: str(cell(d, 5)),
            atmetimoTeisinisPagrindas: str(cell(d, 6)),
            atmetimoPriezastys: str(cell(d, 7)),
            pasiulymoKainaSanaudos: str(cell(d, 8)),
            kainosSanauduIsraiska: str(cell(d, 9)),
        }));
}

function parseVII3(wb) {
    const sheet = assertSheet(wb, "VII.3");
    const rows = toRows(sheet);
    return rows
        .slice(3)
        .filter((r) => r && r.some((v) => v != null))
        .map((d) => ({
            daliesNumeris: num(cell(d, 0)),
            eilesNumeris: num(cell(d, 1)),
            dalyvioKodas: str(cell(d, 2)),
            dalyvioPavadinimas: str(cell(d, 3)),
            kainosKokybesSantykis: str(cell(d, 4)),
            kainaSanaudos: str(cell(d, 5)),
            kainosSanauduIsraiska: str(cell(d, 7)),
        }));
}

function parseIX(wb) {
    const sheet = assertSheet(wb, "IX.");
    const rows = toRows(sheet);
    const d = rows[3];
    if (!d) throw new Error("PPA parse error: IX. missing data row");
    return {
        pretenzijaPateikta: bool(cell(d, 0)),
        ieskinysTeismui: bool(cell(d, 1)),
        interesuKonfliktasNustatytas: bool(cell(d, 2)),
        interesuKonfliktoPriemones: str(cell(d, 3)),
        konkurencijaIskreipiantisAsmuo: bool(cell(d, 4)),
        konkurencijosPriemones: str(cell(d, 5)),
    };
}

function parseX(wb) {
    const sheet = assertSheet(wb, "X.");
    const rows = toRows(sheet, true);
    return rows
        .slice(3)
        .filter((r) => r && r.some((v) => v != null))
        .map((d) => ({
            daliesNumeris: str(cell(d, 0)),
            proceduruPabaiga: str(cell(d, 1)),
            sprendimoPriemimoData: date(cell(d, 2)),
            sprendimoPriezastys: str(cell(d, 3)),
            nutraukimoPriezastys: str(cell(d, 4)),
        }));
}

function parseXI(wb) {
    const sheet = assertSheet(wb, "XI.");
    const rows = toRows(sheet, true);
    const preliminary = str(cell(rows[2], 0))
        ?.toLocaleLowerCase("lt-LT")
        .startsWith("preliminariojoje");
    if (preliminary) {
        return rows
            .slice(3)
            .filter((r) => r && r.slice(1, 7).some((v) => v != null))
            .map((d) => {
                const validity = contractValidity(cell(d, 5));
                return {
                daliesNumeris: str(cell(d, 1)),
                tiekejoKodas: str(cell(d, 2)),
                tiekejoPavadinimas: str(cell(d, 3)),
                sutartiesSudarymoData: date(cell(d, 4)),
                sutartiesGaliojimoTerminas: validity.date,
                sutartiesGaliojimoPastaba: validity.note,
                sutartiesVerte: str(cell(d, 6)),
                arOrientacineVerte: bool(cell(d, 7)),
                arKetinamaSubranga: str(cell(d, 8)),
                subrangosInfo: str(cell(d, 9)),
                centralizuotasPirkimas: null,
                centralizacijosTipas: null,
                zaliasisPirkimas: null,
                energetiniaiReikalavimai: null,
                energetikosPriemones: null,
                inovatyvusProduktas: null,
                kelioTransportoPriemones: null,
                };
            });
    }
    const contracts = [];
    let context = {
        daliesNumeris: null,
        tiekejoKodas: null,
        tiekejoPavadinimas: null,
    };
    for (const d of rows.slice(3)) {
        if (!d) continue;
        if (cell(d, 0) != null) context.daliesNumeris = str(cell(d, 0));
        if (cell(d, 1) != null) context.tiekejoKodas = str(cell(d, 1));
        if (cell(d, 2) != null) context.tiekejoPavadinimas = str(cell(d, 2));

        const rawDate = cell(d, 3);
        const rawValue = cell(d, 5);
        const hasDate = rawDate != null && !/^[-–—]+$/.test(str(rawDate) ?? "");
        // Tiekėjo antraštės, grupės narių ir šablono numatytųjų reikšmių eilutės
        // be sutarties datos ar vertės nėra atskiros sutartys.
        if (!hasDate && rawValue == null) continue;

        const validity = contractValidity(cell(d, 4));
        contracts.push({
            ...context,
            sutartiesSudarymoData: date(rawDate),
            sutartiesGaliojimoTerminas: validity.date,
            sutartiesGaliojimoPastaba: validity.note,
            sutartiesVerte: str(rawValue),
            arOrientacineVerte: bool(cell(d, 6)),
            arKetinamaSubranga: str(cell(d, 7)),
            subrangosInfo: str(cell(d, 8)),
            centralizuotasPirkimas: bool(cell(d, 9)),
            centralizacijosTipas: str(cell(d, 10)),
            zaliasisPirkimas: bool(cell(d, 11)),
            energetiniaiReikalavimai: bool(cell(d, 12)),
            energetikosPriemones: str(cell(d, 13)),
            inovatyvusProduktas: bool(cell(d, 14)),
            kelioTransportoPriemones: bool(cell(d, 15)),
        });
    }
    return contracts;
}

function parseXIII(wb) {
    const sheet = findPpaSheet(wb, "XIII.");
    if (!sheet) {
        return {
            atsakingasAsmuo: null,
            telefonas: null,
            elpastas: null,
            pasirasantisAsmuo: null,
            pasirasantisPareigos: null,
        };
    }
    const rows = toRows(sheet);
    const d = rows[3];
    if (!d) throw new Error("PPA parse error: XIII. missing data row");
    return {
        atsakingasAsmuo: str(cell(d, 0)),
        telefonas: phone(cell(d, 1)),
        elpastas: str(cell(d, 2)),
        pasirasantisAsmuo: str(cell(d, 4)),
        pasirasantisPareigos: str(cell(d, 3)),
    };
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function parsePpaFile(fileId) {
    const url = `${config.internalFileBase}/${fileId}`;
    const res = await scrapeFetch(url);
    if (!res.ok)
        throw new Error(
            `Failed to fetch file ${fileId}: ${res.status} ${res.statusText}`,
        );

    const buffer = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buffer, { cellDates: true, dense: true });

    return {
        bendraInformacija: parseI_III(wb),
        pirkimoDalys: parseIII5(wb),
        pirkimoBudas: parseV_VI2(wb),
        dalyviai: parseVI(wb),
        vertinimoKriterjai: parseVII1(wb),
        atmestiPasiulymai: parseVII2(wb),
        pasiulymuEile: parseVII3(wb),
        skundai: parseIX(wb),
        proceduruPabaiga: parseX(wb),
        sutartys: parseXI(wb),
        kitaInformacija: parseXIII(wb),
    };
}

import { upsertPpa } from "./insert.js";
async function processPpa(fileId, client) {
    try {
        const data = await parsePpaFile(fileId);
        await upsertPpa(client, fileId, data, { manageTransaction: false });
    } catch (err) {
        console.error(`Error processing file ${fileId}:`, err);
        throw err;
    }
}

const PPA_NUSKAITYMAS_VERSIJA = 3;
const PPA_TIPAS = "PPA";
const DEFAULT_CONCURRENCY = 1;
const MAX_CONCURRENCY = 64;

/** Įrašo PPA apdorojimo versiją (arba -1 klaidai) į files."specialTypes". */
async function pazymetiPpa(fileId, statusas, db = postgres) {
    await db.query(
        `WITH tipas AS (
            INSERT INTO files."specialTypeNames" (type) VALUES ($1)
            ON CONFLICT (type) DO UPDATE SET type = EXCLUDED.type
            RETURNING id
        )
        INSERT INTO files."specialTypes" (id, "typeId", status)
        SELECT $2, t.id, $3 FROM tipas t
        ON CONFLICT (id, "typeId") DO UPDATE SET status = EXCLUDED.status`,
        [PPA_TIPAS, fileId, statusas],
    );
}

async function rezervuotiPpa(client) {
    const { rows } = await client.query(
        `SELECT st.id
         FROM files."specialTypes" st
         JOIN files."specialTypeNames" tn ON tn.id = st."typeId"
         WHERE tn.type = $1
           AND ((st.status < $2 AND st.status >= 0) OR st.status IS NULL)
         ORDER BY st.id
         FOR UPDATE OF st SKIP LOCKED
         LIMIT 1`,
        [PPA_TIPAS, PPA_NUSKAITYMAS_VERSIJA],
    );
    return rows.length ? Number(rows[0].id) : null;
}

export async function doOnePpa() {
    const client = await postgres.connect();
    let fileId = null;
    try {
        await client.query("BEGIN");
        fileId = await rezervuotiPpa(client);
        if (fileId == null) {
            await client.query("ROLLBACK");
            return false;
        }

        logger.log(`Apdorojamas PPA failas ${fileId}`);
        await processPpa(fileId, client);
        await pazymetiPpa(fileId, PPA_NUSKAITYMAS_VERSIJA, client);
        await client.query("COMMIT");
        return true;
    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        if (fileId != null) await pazymetiPpa(fileId, -1, client);
        throw e;
    } finally {
        client.release();
    }
}

export function parsePpaArgs(argv) {
    let concurrency = DEFAULT_CONCURRENCY;
    let help = false;
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--help" || argument === "-h") help = true;
        else if (argument === "--concurrency") concurrency = Number(argv[++index]);
        else if (argument.startsWith("--concurrency=")) {
            concurrency = Number(argument.slice("--concurrency=".length));
        } else throw new Error(`Nežinoma parinktis: ${argument}`);
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
        throw new Error(`--concurrency turi būti sveikasis skaičius nuo 1 iki ${MAX_CONCURRENCY}.`);
    }
    return { concurrency, help };
}

export async function processAllPpa({ concurrency = DEFAULT_CONCURRENCY } = {}) {
    let failed = 0;

    const worker = async () => {
        while (true) {
            try {
                if (!(await doOnePpa())) return;
            } catch {
                // doOnePpa jau pažymėjo konkretų failą status=-1 ir išlogino
                // klaidą. Šis slotas lieka gyvas ir iškart ima kitą failą.
                failed++;
            }
        }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    logger.log("Nėra PPA failų apdorojimui");
    if (failed > 0) console.error(`PPA apdorojimas baigtas su ${failed} klaidomis.`);
    return { failed };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    let exitCode = 0;
    try {
        const options = parsePpaArgs(process.argv.slice(2));
        if (options.help) {
            console.log("Naudojimas: node modules/ppa/parse.js [--concurrency=N]");
        } else {
            const result = await processAllPpa(options);
            if (result.failed > 0) exitCode = 1;
        }
    } catch (error) {
        console.error(error?.stack ?? error);
        exitCode = 1;
    } finally {
        await postgres.end();
    }

    // Globalus fetch/logavimo transportas gali laikyti atviras keep-alive
    // jungtis. CLI darbas jau baigtas ir DB pool'as uždarytas, todėl išeiname
    // aiškiai, nelaukdami tų globalių handle'ų.
    process.exit(exitCode);
}
