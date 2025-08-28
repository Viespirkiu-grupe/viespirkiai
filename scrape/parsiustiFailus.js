/*
Parsisiunčia duomenų bazėje nurodytus failus į viešdėžes.
*/

import { postgres } from "../postgres/postgres.js";
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
    const failasRes = await postgres.query(
        "SELECT * FROM failai WHERE parsiustas = 0 ORDER BY id DESC LIMIT 1",
    );

    if (failasRes.rows.length === 0) {
        // No file found
        return;
    }

    const failas = failasRes.rows[0];

    log(`Parsiunčiamas: ${failas.id} (${failas.pavadinimas})`);

    // Randame dėžę, kuri dar turi vietos
    const dezeRes = await postgres.query(
        "SELECT * FROM dezes WHERE used < max LIMIT 1",
    );

    if (dezeRes.rows.length === 0) {
        throw new Error("Nėra dėžių parsisiuntimui.");
    }

    const deze = dezeRes.rows[0];

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
        await postgres.query(
            "UPDATE failai SET parsiustas = 1, md5 = $1, dydis = $2, saugojama = $3 WHERE id = $4",
            [md5, size, deze.pavadinimas, failas.id],
        );
    } catch (error) {
        console.error("Klaida parsisiunčiant failą:", error);
        await postgres.query(
            "UPDATE failai SET parsiustas = -1 WHERE id = $1",
            [failas.id],
        );

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

    await postgres.query("UPDATE dezes SET used = $1 WHERE id = $2", [
        totalSizeBytes,
        deze.id,
    ]);

    log(`Parsiuntimas užtruko: ${Date.now() - startTime} ms`);
    return true;
}
