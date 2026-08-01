/*
Srautinis vieno įrašo ZIP archyvo išpakavimas.

Kodėl ne `adm-zip` (jau yra dependency, naudojamas modules/geografija/importAdresai.js):
jis įsikelia visą įrašą į atmintį, o Regitros CSV yra 228 MB ir task runner suka
18 lygiagrečių darbų. Čia atmintis lieka pastovi — skaitomas tik ZIP local header,
o toliau baitai tiesiog varomi per zlib.
*/
import fs from "node:fs";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

// ZIP local file header: 30 baitai fiksuoto ilgio, po jų pavadinimas ir „extra“.
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_DYDIS = 30;

const METODAS_STORED = 0;
const METODAS_DEFLATE = 8;

/**
 * Nuskaito pirmojo ZIP įrašo local header'į.
 *
 * @param {string} zipKelias - Kelias iki ZIP failo.
 * @returns {Promise<{pavadinimas: string, metodas: number, suspaustasDydis: number, issuspaustasDydis: number, duomenuPozicija: number}>}
 */
async function nuskaitytiHeaderi(zipKelias) {
    const fh = await fs.promises.open(zipKelias, "r");
    try {
        const header = Buffer.alloc(LOCAL_HEADER_DYDIS);
        const { bytesRead } = await fh.read(header, 0, LOCAL_HEADER_DYDIS, 0);
        if (bytesRead < LOCAL_HEADER_DYDIS) {
            throw new Error("ZIP failas per trumpas — nėra local header'io");
        }
        if (header.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
            throw new Error("Netinkamas ZIP failas (nesutampa parašas)");
        }

        const veliaveles = header.readUInt16LE(6);
        // 3-ias bitas reiškia, kad dydžiai yra ne header'yje, o data descriptor'iuje
        // po suspaustų duomenų — tada srauto apriboti negalime.
        if (veliaveles & 0x08) {
            throw new Error(
                "ZIP įrašas naudoja data descriptor'ių — dydžiai nežinomi iš anksto",
            );
        }

        const metodas = header.readUInt16LE(8);
        const suspaustasDydis = header.readUInt32LE(18);
        const issuspaustasDydis = header.readUInt32LE(22);
        const pavadinimoIlgis = header.readUInt16LE(26);
        const extraIlgis = header.readUInt16LE(28);

        const pavadinimoBuferis = Buffer.alloc(pavadinimoIlgis);
        await fh.read(pavadinimoBuferis, 0, pavadinimoIlgis, LOCAL_HEADER_DYDIS);

        return {
            pavadinimas: pavadinimoBuferis.toString("utf8"),
            metodas,
            suspaustasDydis,
            issuspaustasDydis,
            duomenuPozicija:
                LOCAL_HEADER_DYDIS + pavadinimoIlgis + extraIlgis,
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
    const irasas = await nuskaitytiHeaderi(zipKelias);

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
