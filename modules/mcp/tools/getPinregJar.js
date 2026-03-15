import { z } from "zod";
import { gautiPinregDeklaracijasPagalJarKoda } from "../../pinreg/pinregDeklaracijos.js";

const DEFAULT_LIMIT = 20;

export const name = "get_pinreg_jar";
export const description =
    "Grąžina PINREG privačių interesų deklaracijas pagal juridinio asmens kodą. Apima darbovietes, sutuoktinių darbovietes ir ryšius su juridiniu asmeniu.";

export const schema = {
    jarKodas: z.string().describe("Juridinio asmens kodas"),
    limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(DEFAULT_LIMIT)
        .describe(
            "Maksimalus įrašų skaičius kiekvienoje kategorijoje (maks. 100)",
        ),
};

export async function handler({ jarKodas, limit = DEFAULT_LIMIT }) {
    const result = await gautiPinregDeklaracijasPagalJarKoda(jarKodas, {
        limit,
    });
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
}
