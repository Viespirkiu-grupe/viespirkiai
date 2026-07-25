import { postgres } from "../../postgres/postgres.js";
import { FILES_SELECT, FILES_JOINS, papildytiFaila } from "../failai/filesSkaitymas.js";

/*
Prie `turinys.failai[].versijos[]` prisega lokaliai turimo failo duomenis.

cvpIs šaltinio ID senoje schemoje buvo vientisas `pirkimoId/dokumentasId/versionId`
tekstas `failai."saltinioId"` stulpelyje. `files` lentelėje jis išskaidytas:

    sourceId0 = pirkimoId, sourceId1 = dokumentasId, sourceId2 = versionId

Imama viskas pagal `sourceId0` (vieno pirkimo failų vienetai), o siejama pagal
`sourceId1` — `viesiejiPirkimaiFailuVersijos.versionId` ne visada sutampa su tuo,
kas įrašyta `sourceId2` (dalis versijų neišsisaugojo). Kai versijų yra kelios,
pirmenybė vis tiek atitenka tiksliam `sourceId2` = `versionId` atitikmeniui.

Grąžinami laukai lieka tokie patys, kokius rodė UI ir MCP išvestis
(`parsiustas`, `nuskaitytas`, `zodziuSkaicius`, ...) — juos iš naujos schemos
atkuria filesSkaitymas.js.
*/

/**
 * @param {string|number} pirkimoId
 * @param {any[]} failai - assembleTurinys grąžinti `turinys.failai`
 * @param {import("pg").ClientBase} [klientas]
 */
export async function prisegtiLokaliusFailus(pirkimoId, failai, klientas = postgres) {
    if (!(failai ?? []).length) return;

    const { rows } = await klientas.query(
        `SELECT ${FILES_SELECT}
         FROM public.files f
         ${FILES_JOINS}
         WHERE f."sourceTitleId" = (SELECT id FROM public."filesSourceTitles" WHERE title = 'cvpIs')
           AND f."sourceId0" = $1`,
        [String(pirkimoId)],
    );
    if (!rows.length) return;

    // dokumentasId → to dokumento failų eilutės (dažniausiai viena).
    const pagalDokumenta = new Map();
    for (const eilute of rows) {
        const raktas = String(eilute.sourceId1);
        const sarasas = pagalDokumenta.get(raktas) ?? [];
        sarasas.push(papildytiFaila(eilute));
        pagalDokumenta.set(raktas, sarasas);
    }

    for (const failas of failai) {
        const kandidatai = pagalDokumenta.get(String(failas.dokumentasId));
        if (!kandidatai?.length) continue;
        for (const versija of failas.versijos ?? []) {
            const failasEilute =
                kandidatai.find((f) => String(f.sourceId2) === String(versija.versionId)) ??
                kandidatai[kandidatai.length - 1];
            // `pavadinimas` neperrašomas — versija turi savo, o failo vardas
            // matomas per /failas/{id}.
            const {
                id, extension, parsiustas, nuskaitytas,
                zodziuSkaicius, puslapiuSkaicius, dydis, md5,
            } = failasEilute;
            Object.assign(versija, {
                id, extension, parsiustas, nuskaitytas,
                zodziuSkaicius, puslapiuSkaicius, dydis, md5,
            });
        }
    }
}
