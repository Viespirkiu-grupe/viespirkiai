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
function num(v) {
    return v != null && v !== "" ? Number(v) : null;
}
function date(v) {
    return v != null ? str(v) : null;
}

function assertSheet(wb, name) {
    // sheet names may have leading/trailing spaces
    const found = wb.SheetNames.find((s) => s.trim() === name.trim());
    if (!found) throw new Error(`PPA parse error: expected sheet "${name}"`);
    return wb.Sheets[found];
}

function toRows(sheet) {
    return XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: false,
        dateNF: "yyyy/mm/dd",
    });
}

// ── sheet parsers ─────────────────────────────────────────────────────────────

function parseI_III(wb) {
    const sheet = assertSheet(wb, "I.–III.");
    const rows = toRows(sheet);
    // header row is row 5 (idx 5), data row is idx 6
    const d = rows[6];
    if (!d) throw new Error("PPA parse error: I.–III. missing data row");
    return {
        teisinisPageindas: str(cell(d, 0)),
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

function parseIII5(wb) {
    const sheet = assertSheet(wb, "III.5");
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
    const sheet = assertSheet(wb, "V.–VI.2");
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

function parseVI(wb) {
    const sheet = assertSheet(wb, " VI.");
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
    const sheet = assertSheet(wb, "VII.1");
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
    const rows = toRows(sheet);
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
    const rows = toRows(sheet);
    return rows
        .slice(3)
        .filter((r) => r && r.some((v) => v != null))
        .map((d) => ({
            daliesNumeris: str(cell(d, 0)),
            tiekejoKodas: str(cell(d, 1)),
            tiekejoPavadinimas: str(cell(d, 2)),
            sutartiesSudarymoData: date(cell(d, 3)),
            sutartiesGaliojimoTerminas: str(cell(d, 4)),
            sutartiesVerte: str(cell(d, 5)),
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
        }));
}

function parseXIII(wb) {
    const sheet = assertSheet(wb, "XIII.");
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

export async function parseAtn1File(fileId) {
    const url = `${config.internalFileBase}/${fileId}`;
    const res = await fetch(url);
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

import { upsertAtn1 } from "./insert.js";
async function processAtn1(fileId) {
    let client;
    try {
        client = await postgres.connect();
        const data = await parseAtn1File(fileId);
        await upsertAtn1(client, fileId, data);
    } catch (err) {
        console.error(`Error processing file ${fileId}:`, err);
        throw err;
    } finally {
        // ensure client is closed in case of error
        if (client && !client.ended) {
            client.release();
        }
    }
}

const ATN_NUSKAITYMAS_VERSIJA = 3;
const ATN1_TIPAS = "ATN-1";

/** Įrašo ATN-1 apdorojimo versiją (arba -1 klaidai) į filesSpecialTypes. */
async function pazymetiAtn1(fileId, statusas) {
    await postgres.query(
        `WITH tipas AS (
            INSERT INTO public."filesSpecialTypeNames" (type) VALUES ($1)
            ON CONFLICT (type) DO UPDATE SET type = EXCLUDED.type
            RETURNING id
        )
        INSERT INTO public."filesSpecialTypes" (id, "typeId", status)
        SELECT $2, t.id, $3 FROM tipas t
        ON CONFLICT (id, "typeId") DO UPDATE SET status = EXCLUDED.status`,
        [ATN1_TIPAS, fileId, statusas],
    );
}

export async function doOneAtn1() {
    // Vienas ATN-1 failas, kurio apdorojimo versija senesnė už dabartinę.
    let rowRes = await postgres.query(
        `SELECT st.id
         FROM public."filesSpecialTypes" st
         JOIN public."filesSpecialTypeNames" tn ON tn.id = st."typeId"
         WHERE tn.type = $1
           AND ((st.status < $2 AND st.status >= 0) OR st.status IS NULL)
         LIMIT 1`,
        [ATN1_TIPAS, ATN_NUSKAITYMAS_VERSIJA],
    );
    if (rowRes.rowCount === 0) {
        logger.log("Nėra ATN-1 failų apdorojimui");
        return false;
    }
    const fileId = rowRes.rows[0].id;
    logger.log(`Apdorojamas ATN-1 failas ${fileId}`);
    try {
        await processAtn1(fileId);
        await pazymetiAtn1(fileId, ATN_NUSKAITYMAS_VERSIJA);
    } catch (e) {
        await pazymetiAtn1(fileId, -1);
        throw e;
    }
    return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    // if (!fileId) {
    //     console.error("Usage: node parse-ppa.mjs <fileId>");
    //     process.exit(1);
    // }
    (async () => {
        while (await doOneAtn1()) {}
    })();
}
