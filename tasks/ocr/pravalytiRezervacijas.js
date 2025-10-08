import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

export async function pravalytiOcrRezervacijas() {
    await postgres.query(`UPDATE failai
    SET
        "ocrState" = 0,
        "ocrLockTimestamp" = NULL,
        "ocrNode" = NULL
    WHERE "ocrState" = -3
      AND "ocrLockTimestamp" <= (now() AT TIME ZONE 'Europe/Vilnius' - interval '6 hours');
`);
    log(`Išvalytos rezervuotos OCR užduotys.`);
}
