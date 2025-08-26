/*
Parsisiunčia duomenų bazėje nurodytus failus į viešdėžes.
*/

import { mysql } from "../mysql/mysql.js";
import { log } from "../utils/log.js";

/**
 * Blokuoja funkcijos vykdymą darbo valandomis (07:45–17:15, darbo dienomis).
 * Jei funkcija iškviečiama darbo valandomis, išmetamas klaidos pranešimas.
 * @throws {Error} Jei funkcija iškviečiama darbo valandomis.
 */
function blockDuringWorkingHours() {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    const hours = now.getHours();
    const minutes = now.getMinutes();

    // Check if it's a weekday
    if (day >= 1 && day <= 5) {
        // Convert time to minutes since midnight
        const currentMinutes = hours * 60 + minutes;
        const start = 7 * 60 + 45; // 07:45
        const end = 17 * 60 + 15; // 17:15

        if (currentMinutes >= start && currentMinutes <= end) {
            throw new Error(
                "Function is blocked during working hours (07:45–17:15, weekdays).",
            );
        }
    }
}

/**
 * Parsiunčia vieną neparsiųstą failą į viešdėžę.
 * @returns {Promise<boolean>} true jei pavyko parsisiųsti failą, false jei nėra failų parsisiuntimui
 */
export async function parsiustiFaila() {
    blockDuringWorkingHours();
    let startTime = Date.now();

    // Randame failą, kuris dar neparsiųstas
    let [failas] = await mysql.execute(
        "SELECT * FROM failai WHERE parsiustas = 0 ORDER BY id DESC LIMIT 1",
    );

    if (Array.isArray(failas)) {
        failas = failas[0];
    }

    if (!failas) {
        log("Nėra failų parsisiuntimui.");
        return false; // Visi failai jau parsiųsti
    } else {
        log(`Parsiunčiamas: ${failas.id} (${failas.pavadinimas})`);
    }

    // Randame dėžę, kuri dar turi vietos
    let [deze] = await mysql.execute(
        "SELECT * FROM dezes WHERE used < max LIMIT 1",
    );

    if (Array.isArray(deze)) {
        deze = deze[0];
    }

    if (!deze) {
        throw new Error("Nėra dėžių parsisiuntimui.");
    }

    try {
        // Pateikiame parsisiuntimo užklausą
        let response = await fetch(`${deze.url}/download-url`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": deze.apiKey,
            },
            body: JSON.stringify({
                url: `http://localhost:9029/${failas.dokId}/${failas.fileId}`,
            }),
        });

        var { md5, size } = await response.json();

        if (!response.ok || !md5) {
            throw new Error("Nepavyko gauti failo.");
        }

        // Atnaujiname informaciją apie failą
        await mysql.execute(
            "UPDATE failai SET parsiustas = 1, md5 = ?, dydis = ?, saugojama = ? WHERE id = ?",
            [md5, size, deze.pavadinimas, failas.id],
        );
    } catch (error) {
        console.error("Klaida parsisiunčiant failą:", error);
        await mysql.execute("UPDATE failai SET parsiustas = -1 WHERE id = ?", [
            failas.id,
        ]);

        throw error;
    }

    log(
        `Failas ${failas.pavadinimas} (${failas.id}) parsisiųstas ir atnaujintas (dydis=${size}B)`,
    );

    // Atnaujiname dėžės dydį
    let usedReq = await fetch(`${deze.url}/storage-usage`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": deze.apiKey,
        },
    });
    let { totalSizeBytes } = await usedReq.json();

    await mysql.execute("UPDATE dezes SET used = ? WHERE id = ?", [
        totalSizeBytes,
        deze.id,
    ]);

    log(`Parsiuntimas užtruko: ${Date.now() - startTime} ms`);
    return true;
}
