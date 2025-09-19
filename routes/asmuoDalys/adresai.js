import { postgres } from "../../postgres/postgres.js";

export async function gautiAdresoKoordinatesPagalId(adresoId) {
    const { rows: adresasRezultatai } = await postgres.query(
        `SELECT latitude, longitude FROM adresai WHERE id = $1`,
        [adresoId],
    );

    if (adresasRezultatai.length > 0) {
        const row = adresasRezultatai[0];
        return {
            y: parseFloat(row.latitude),
            x: parseFloat(row.longitude),
        };
    }

    return;
}
