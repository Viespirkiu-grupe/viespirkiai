import { postgres } from "../../postgres/postgres.js";

export async function gautiNepatikimuTiekejuIrasus(jarKodas) {
    const { rows: nepatikimiTiekejaiRezultatai } = await postgres.query(
        `SELECT * FROM "nepatikimiTiekejai" WHERE "tiekejoJarKodas" = $1`,
        [jarKodas],
    );

    const { rows: nepatikimiTiekejaiPagrindimaiRezultatai } =
        await postgres.query(
            `SELECT * FROM "nepatikimiTiekejaiPagrindimai" WHERE "tiekejoJarKodas" = $1`,
            [jarKodas],
        );

    const nepatikimiTiekejai = nepatikimiTiekejaiRezultatai.map((tiekejas) => {
        let pagrindimai = nepatikimiTiekejaiPagrindimaiRezultatai.filter(
            (pagrindimas) =>
                pagrindimas.tiekejoJarKodas === tiekejas.tiekejoJarKodas,
        );
        pagrindimai = pagrindimai.filter(
            (pagrindimas) =>
                pagrindimas.pirkimoNumeris === tiekejas.pirkimoNumeris,
        );

        let pagrindimas;

        if (pagrindimai.length > 0) {
            pagrindimas = pagrindimai[0];
        }

        return {
            ...tiekejas,
            pagrindimas,
        };
    });

    return nepatikimiTiekejai;
}
