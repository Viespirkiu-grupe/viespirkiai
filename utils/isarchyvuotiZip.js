/*
Srautinis vieno įrašo ZIP archyvo išpakavimas.

Kodėl ne `adm-zip` (jau yra dependency, naudojamas modules/geografija/importAdresai.js):
jis įsikelia visą įrašą į atmintį, o Regitros CSV yra 228 MB, Sodros — 95 MB, ir task
runner suka 18 lygiagrečių darbų. Čia atmintis lieka pastovi — nuskaitomas tik centrinis
katalogas, o toliau baitai tiesiog varomi per zlib.

Dydžiai imami iš centrinio katalogo (archyvo gale), o ne iš local header'io: Sodros ZIP
naudoja data descriptor'ių (3-ias vėliavėlių bitas), tad local header'yje dydžiai yra
nuliai. Centriniame kataloge jie teisingi visada.
*/
import fs from "node:fs";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

// End of central directory record: 22 baitai + iki 65535 baitų komentaro.
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_DYDIS = 22;
const MAX_KOMENTARAS = 0xffff;

// Centrinio katalogo įrašas: 46 baitai fiksuoto ilgio, po jų pavadinimas, „extra“ ir komentaras.
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_DYDIS = 46;

// Local file header: 30 baitai fiksuoto ilgio, po jų pavadinimas ir „extra“.
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_DYDIS = 30;

// ZIP64 žymuo — tikrieji dydžiai tada guli „extra“ lauke, o mūsų failai iki jo neprieina.
const ZIP64_ZYMUO = 0xffffffff;

const METODAS_STORED = 0;
const METODAS_DEFLATE = 8;

/**
 * Suranda centrinio katalogo pabaigos įrašą (EOCD) archyvo gale.
 *
 * @param {fs.promises.FileHandle} fh
 * @param {number} failoDydis
 * @returns {Promise<{irasuSkaicius: number, katalogoPozicija: number}>}
 */
async function rastiEocd(fh, failoDydis) {
    const ilgis = Math.min(failoDydis, EOCD_DYDIS + MAX_KOMENTARAS);
    if (ilgis < EOCD_DYDIS) {
        throw new Error("ZIP failas per trumpas — nėra centrinio katalogo");
    }

    const buferis = Buffer.alloc(ilgis);
    await fh.read(buferis, 0, ilgis, failoDydis - ilgis);

    for (let i = buferis.length - EOCD_DYDIS; i >= 0; i--) {
        if (buferis.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
        return {
            irasuSkaicius: buferis.readUInt16LE(i + 10),
            katalogoPozicija: buferis.readUInt32LE(i + 16),
        };
    }
    throw new Error("Netinkamas ZIP failas (nerastas centrinis katalogas)");
}

/**
 * Nuskaito pirmojo įrašo aprašą iš centrinio katalogo.
 *
 * @param {string} zipKelias - Kelias iki ZIP failo.
 * @returns {Promise<{pavadinimas: string, metodas: number, suspaustasDydis: number, issuspaustasDydis: number, duomenuPozicija: number}>}
 */
async function nuskaitytiIrasoAprasa(zipKelias) {
    const fh = await fs.promises.open(zipKelias, "r");
    try {
        const { size } = await fh.stat();
        const { irasuSkaicius, katalogoPozicija } = await rastiEocd(fh, size);
        if (irasuSkaicius === 0) {
            throw new Error("ZIP archyvas tuščias");
        }

        const centrinis = Buffer.alloc(CENTRAL_HEADER_DYDIS);
        await fh.read(centrinis, 0, CENTRAL_HEADER_DYDIS, katalogoPozicija);
        if (centrinis.readUInt32LE(0) !== CENTRAL_HEADER_SIGNATURE) {
            throw new Error("Netinkamas ZIP failas (nesutampa įrašo parašas)");
        }

        const metodas = centrinis.readUInt16LE(10);
        const suspaustasDydis = centrinis.readUInt32LE(20);
        const issuspaustasDydis = centrinis.readUInt32LE(24);
        const pavadinimoIlgis = centrinis.readUInt16LE(28);
        const localPozicija = centrinis.readUInt32LE(42);

        if (
            suspaustasDydis === ZIP64_ZYMUO ||
            issuspaustasDydis === ZIP64_ZYMUO ||
            localPozicija === ZIP64_ZYMUO
        ) {
            throw new Error("ZIP64 archyvai nepalaikomi");
        }

        const pavadinimoBuferis = Buffer.alloc(pavadinimoIlgis);
        await fh.read(
            pavadinimoBuferis,
            0,
            pavadinimoIlgis,
            katalogoPozicija + CENTRAL_HEADER_DYDIS,
        );

        // Duomenų pradžią lemia local header'is: jo pavadinimo ir „extra“ ilgiai gali
        // skirtis nuo centrinio katalogo.
        const local = Buffer.alloc(LOCAL_HEADER_DYDIS);
        await fh.read(local, 0, LOCAL_HEADER_DYDIS, localPozicija);
        if (local.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
            throw new Error(
                "Netinkamas ZIP failas (nesutampa local header'io parašas)",
            );
        }

        return {
            pavadinimas: pavadinimoBuferis.toString("utf8"),
            metodas,
            suspaustasDydis,
            issuspaustasDydis,
            duomenuPozicija:
                localPozicija +
                LOCAL_HEADER_DYDIS +
                local.readUInt16LE(26) +
                local.readUInt16LE(28),
        };
    } finally {
        await fh.close();
    }
}

/**
 * Išpakuoja pirmąjį ZIP archyvo įrašą į nurodytą failą.
 *
 * @param {string} zipKelias - Kelias iki ZIP failo.
 * @param {string} isvestiesKelias - Kur įrašyti išpakuotą failą.
 * @returns {Promise<{pavadinimas: string, dydis: number}>} Įrašo pavadinimas archyve ir išpakuotas dydis.
 */
export async function isarchyvuotiPirmaIrasa(zipKelias, isvestiesKelias) {
    const irasas = await nuskaitytiIrasoAprasa(zipKelias);

    if (
        irasas.metodas !== METODAS_DEFLATE &&
        irasas.metodas !== METODAS_STORED
    ) {
        throw new Error(
            `Nepalaikomas ZIP suspaudimo metodas: ${irasas.metodas}`,
        );
    }

    // Skaitome tiksliai tiek baitų, kiek užima suspausti duomenys — taip į zlib
    // nepatenka nei data descriptor'ius, nei centrinis katalogas archyvo gale.
    const skaitymas = fs.createReadStream(zipKelias, {
        start: irasas.duomenuPozicija,
        end: irasas.duomenuPozicija + irasas.suspaustasDydis - 1,
    });
    const rasymas = fs.createWriteStream(isvestiesKelias);

    if (irasas.metodas === METODAS_STORED) {
        await pipeline(skaitymas, rasymas);
    } else {
        await pipeline(skaitymas, zlib.createInflateRaw(), rasymas);
    }

    const { size } = await fs.promises.stat(isvestiesKelias);
    if (size !== irasas.issuspaustasDydis) {
        throw new Error(
            `Išpakuotas dydis nesutampa: gauta ${size}, tikėtasi ${irasas.issuspaustasDydis}`,
        );
    }

    return { pavadinimas: irasas.pavadinimas, dydis: size };
}
