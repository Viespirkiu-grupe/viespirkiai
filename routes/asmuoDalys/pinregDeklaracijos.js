import { postgres } from "../../postgres/postgres.js";

export async function gautiPinregDeklaracijas(jarKodas) {
    let deklaracijosRes = await postgres.query(
        `SELECT *
  FROM public.pinreg
  WHERE "darbovietesJar" @> ARRAY[$1]
     OR "juridiniaiRysiaiJar" @> ARRAY[$2]
     OR "sutuoktinisDarbovietesJar" @> ARRAY[$3]
  ORDER BY
      CASE
          WHEN "darbovietesJar" @> ARRAY[$4] THEN 1
          WHEN "juridiniaiRysiaiJar" @> ARRAY[$5] THEN 2
          WHEN "sutuoktinisDarbovietesJar" @> ARRAY[$6] THEN 3
          ELSE 4
      END;`,
        [jarKodas, jarKodas, jarKodas, jarKodas, jarKodas, jarKodas],
    );

    let deklaracijos = deklaracijosRes.rows;

    // Order by deklaracija.pateikimoData;
    deklaracijos.sort((a, b) => {
        let dateA = new Date(a.json.pateikimoData);
        let dateB = new Date(b.json.pateikimoData);
        return dateB - dateA;
    });

    let darbovietes = [];
    let sutuoktinioDarbovietes = [];
    let rysiaiSuJa = [];

    deklaracijos.forEach((deklaracija) => {
        // Convert to title case
        deklaracija.asmuo = deklaracija.asmuo
            .toLowerCase()
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");

        deklaracija.sutuoktinis = deklaracija.sutuoktinis
            ? deklaracija.sutuoktinis
                  .toLowerCase()
                  .split(" ")
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(" ")
            : null;

        // Censor names (* except first and last letter of each word)
        deklaracija.asmuo = deklaracija.asmuo
            .split(" ")
            .map((word) => {
                if (word.length <= 2) return word; // Do not censor very short words
                return (
                    word.charAt(0) +
                    "*".repeat(word.length - 2) +
                    word.charAt(word.length - 1)
                );
            })
            .join(" ");

        if (deklaracija.sutuoktinis) {
            deklaracija.sutuoktinis = deklaracija.sutuoktinis
                .split(" ")
                .map((word) => {
                    if (word.length <= 2) return word; // Do not censor very short words
                    return (
                        word.charAt(0) +
                        "*".repeat(word.length - 2) +
                        word.charAt(word.length - 1)
                    );
                })
                .join(" ");
        }

        deklaracija.json.darbovietes.forEach((darboviete) => {
            if (darboviete.jaKodas && darboviete.jaKodas == jarKodas) {
                darbovietes.push({
                    ...darboviete,
                    uuid: deklaracija.uuid,
                    asmuo: deklaracija.asmuo,
                    pateikimoData: deklaracija.json.pateikimoData,
                });
            }
        });

        deklaracija.json.sutuoktinioDarbovietes.forEach((darboviete) => {
            if (darboviete.jaKodas && darboviete.jaKodas == jarKodas) {
                sutuoktinioDarbovietes.push({
                    ...darboviete,
                    uuid: deklaracija.uuid,
                    asmuo: deklaracija.asmuo,
                    sutuoktinis: deklaracija.sutuoktinis,
                    pateikimoData: deklaracija.json.pateikimoData,
                });
            }
        });

        deklaracija.json.rysiaiSuJa.forEach((rysys) => {
            if (rysys.jaKodas && rysys.jaKodas == jarKodas) {
                rysiaiSuJa.push({
                    ...rysys,
                    uuid: deklaracija.uuid,
                    asmuo: deklaracija.asmuo,
                    pateikimoData: deklaracija.json.pateikimoData,
                });
            }
        });

        if (deklaracija?.json?.teikejas) {
            deklaracija.json.teikejas.vardas = null;
            deklaracija.json.teikejas.pavarde = null;
        }

        if (deklaracija?.json?.sutuoktinis) {
            deklaracija.json.sutuoktinis.vardas = null;
            deklaracija.json.sutuoktinis.pavarde = null;
        }
    });

    return { deklaracijos, darbovietes, sutuoktinioDarbovietes, rysiaiSuJa };
}
