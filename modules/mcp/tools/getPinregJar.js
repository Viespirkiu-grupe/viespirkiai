import { z } from "zod";
import { gautiPinregDeklaracijasPagalJarKoda } from "../../pinreg/pinregDeklaracijos.js";
import { pertvarkytiPinregAsmenims } from "../../pinreg/pinregMcpStruktura.js";

const DEFAULT_LIMIT = 20;

export const name = "get_pinreg_jar";
export const description =
    "Grąžina PINREG privačių interesų deklaracijas pagal juridinio asmens kodą (JAR perspektyva). Grąžina vieną `asmenys` sąrašą (tiesioginės ir sutuoktinių darbovietės su `rysys` lauku) bei `rysiaiSuJa`; kiekvienas asmuo apima visą savo deklaracijų istoriją. Tai parodo, kas susijęs su šia įstaiga (narystė, pareigos, ryšiai), bet NE asmens sandorius, turtą ar paskolas — jei reikia turtinės informacijos, naudok get_pinreg_asmuo (asmens perspektyva).";

export const schema = {
    jarKodas: z.string().describe("Juridinio asmens kodas"),
    limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(DEFAULT_LIMIT)
        .describe(
            "Maksimalus unikalių asmenų skaičius kiekvienoje kategorijoje (maks. 100)",
        ),
};

export async function handler({ jarKodas, limit = DEFAULT_LIMIT }) {
    // Traukiame visus įrašus (be SQL LIMIT), kad asmenis būtų galima
    // sugrupuoti; `limit` taikomas asmenims pertvarkymo metu.
    const result = await gautiPinregDeklaracijasPagalJarKoda(jarKodas);
    const optimizuota = pertvarkytiPinregAsmenims(result, { limit });
    return {
        content: [
            { type: "text", text: JSON.stringify(optimizuota, null, 2) },
        ],
    };
}
