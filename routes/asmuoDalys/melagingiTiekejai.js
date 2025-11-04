import { postgres } from "../../postgres/postgres.js";

export async function gautiMelaginguTiekejuIrasus(jarKodas) {
    const { rows: melagingiTiekejaiRezultatai } = await postgres.query(
        `SELECT * FROM "melagingiTiekejai" WHERE "tiekejoJarKodas" = $1`,
        [jarKodas],
    );

    const { rows: melagingiTiekejaiPagrindimaiRezultatai } =
        await postgres.query(
            `SELECT * FROM "melagingiTiekejaiPagrindimai" WHERE "tiekejoJarKodas" = $1`,
            [jarKodas],
        );

    const melagiai = melagingiTiekejaiRezultatai.map((tiekejas) => {
        let pagrindimai = melagingiTiekejaiPagrindimaiRezultatai.filter(
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

    return melagiai;
}
