import { mysql } from "../mysql/mysql.js";

async function parsiustiFaila(){
    let [failas] = await mysql.execute(
        "SELECT * FROM failai WHERE parsiustas = 0 LIMIT 1"
    );

    if (Array.isArray(failas)) {
        failas = failas[0];
    }

    if (!failas) {
        console.log("Nėra failų parsisiuntimui.");
        return false;
    }


    // where used < max
    let [deze] = await mysql.execute(
        "SELECT * FROM dezes WHERE used < max LIMIT 1"
    );

    if (Array.isArray(deze)) {
        deze = deze[0];
    }

    if (!deze) {
        throw new Error("Nėra dėžių parsisiuntimui.");
    }

    let response = await fetch(`${deze.url}/download-url`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": deze.apiKey,
        },
        body: JSON.stringify({ url: `https://proxy.viespirkiai.top/${failas.dokId}/${failas.fileId}` })
    })
    
    let {md5, size } = await response.json();

    // update failas
    await mysql.execute(
        "UPDATE failai SET parsiustas = 1, md5 = ?, dydis = ?, saugojama = ? WHERE id = ?",
        [md5, size, deze.pavadinimas, failas.id]
    );

    console.log(`Failas ${failas.pavadinimas} (${failas.id}) parsisiųstas ir atnaujintas: md5=${md5}, dydis=${size}, saugojama=${deze.pavadinimas}`);

    // update deze
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
}

while (true) {
    const startTime = Date.now();
    const result = await parsiustiFaila();
    const endTime = Date.now();

    if (result === false) {
        break;
    }

    console.log(`Parsisiuntimas užtruko: ${endTime - startTime} ms`);
}