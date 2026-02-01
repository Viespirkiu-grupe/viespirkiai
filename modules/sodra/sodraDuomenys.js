import { postgres } from "../../postgres/postgres.js";

export async function gautiSodrosDuomenis(jarKodas) {
    const { rows: sodraRezultatai } = await postgres.query(
        `SELECT * FROM sodra WHERE "jarKodas" = $1 ORDER BY "data" ASC`,
        [jarKodas],
    );

    let sodra;
    if (sodraRezultatai.length > 0) {
        const pirmas = sodraRezultatai.at(-1);

        const formatDate = (date) =>
            `${date}`.slice(0, 4) + "-" + `${date}`.slice(4, 6);

        const naudojamiNaujausi = [
            "kodas",
            "jarKodas",
            "pavadinimas",
            "savivaldybe",
            "ekonominesVeiklosKodas",
            "ekonominesVeiklosPavadinimas",
            "vidutinisAtlyginimas",
            "vidutinisAtlyginimas2",
            "draustieji",
            "draustieji2",
            "imokuSuma",
        ];

        sodra = Object.fromEntries(
            naudojamiNaujausi.map((key) => [key, pirmas[key]]),
        );

        sodra.data = formatDate(pirmas.data);

        sodra.bendrasDraustujuSkaicius = pirmas.draustieji + pirmas.draustieji2;

        sodra.bendrasVidutinisAtlyginimas =
            (pirmas.vidutinisAtlyginimas * pirmas.draustieji +
                pirmas.vidutinisAtlyginimas2 * pirmas.draustieji2) /
            sodra.bendrasDraustujuSkaicius;

        sodra.atlyginimuIslaidos = parseFloat(
            (
                sodra.bendrasVidutinisAtlyginimas *
                sodra.bendrasDraustujuSkaicius
            ).toFixed(2),
        );

        sodra.duomenys = sodraRezultatai.map((row) => ({
            data: formatDate(row.data),
            vidutinisAtlyginimas: row.vidutinisAtlyginimas,
            draustieji: row.draustieji,
            vidutinisAtlyginimas2: row.vidutinisAtlyginimas2,
            draustieji2: row.draustieji2,
            imokuSuma: row.imokuSuma,
        }));

        // Loop over data and check for null values
        sodra.turejoDraustuju = sodra.duomenys.some(
            (row) => row.draustieji > 0,
        );

        sodra.turejoDraustuju2 = sodra.duomenys.some(
            (row) => row.draustieji2 > 0,
        );

        sodra.turejoAtlyginimu = sodra.duomenys.some(
            (row) => row.vidutinisAtlyginimas > 0,
        );

        sodra.turejoAtlyginimu2 = sodra.duomenys.some(
            (row) => row.vidutinisAtlyginimas2 > 0,
        );
    }

    return sodra;
}
