/*
Parsisiunčia duomenų bazėje nurodytus failus į viešdėžes.
*/

import { mysql } from "../mysql/mysql.js";

while (true) {
    try {
        var result = await parsiustiFaila();

    } catch (error) {
        console.error("Klaida vykdant parsisiuntimą:", error);
        // Palaukiam 60s
        await new Promise(resolve => setTimeout(resolve, 60000));
        continue; // Tęsiame ciklą        
    }

    if (result === false) {
        process.exit(0); // Visi failai jau parsiųsti
    }
}

/**
 * Parsiunčia vieną neparsiųstą failą į viešdėžę.
 * @returns {Promise<boolean>} true jei pavyko parsisiųsti failą, false jei nėra failų parsisiuntimui
 */
async function parsiustiFaila(){
    let startTime = Date.now();

    // Randame failą, kuris dar neparsiųstas
    let [failas] = await mysql.execute(
        "SELECT * FROM failai WHERE parsiustas = 0 LIMIT 1"
    );

    if (Array.isArray(failas)) {
        failas = failas[0];
    }

    if (!failas) {
        console.log("Nėra failų parsisiuntimui.");
        return false; // Visi failai jau parsiųsti
    }


    // Randame dėžę, kuri dar turi vietos
    let [deze] = await mysql.execute(
        "SELECT * FROM dezes WHERE used < max LIMIT 1"
    );

    if (Array.isArray(deze)) {
        deze = deze[0];
    }

    if (!deze) {
        throw new Error("Nėra dėžių parsisiuntimui.");
    }

    // Pateikiame parsisiuntimo užklausą
    let response = await fetch(`${deze.url}/download-url`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": deze.apiKey,
        },
        body: JSON.stringify({ url: `https://fileproxy.vp-a72.workers.dev/${failas.dokId}/${failas.fileId}` })
    })
    
    let {md5, size } = await response.json();

    // Atnaujiname informaciją apie failą
    await mysql.execute(
        "UPDATE failai SET parsiustas = 1, md5 = ?, dydis = ?, saugojama = ? WHERE id = ?",
        [md5, size, deze.pavadinimas, failas.id]
    );

    console.log(`Failas ${failas.pavadinimas} (${failas.id}) parsisiųstas ir atnaujintas: md5=${md5}, dydis=${size}, saugojama=${deze.pavadinimas}`);

    // Atnaujiname dėžės dydį
    let usedReq = await fetch(`${deze.url}/storage-usage`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": deze.apiKey,
        }
    })
    let { totalSizeBytes } = await usedReq.json();

    await mysql.execute(
        "UPDATE dezes SET used = ? WHERE id = ?",
        [totalSizeBytes, deze.id]
    );

    console.log(`Parsiuntimo laikas: ${Date.now() - startTime} ms`);
    return true; // Pavyko parsisiųsti failą
}