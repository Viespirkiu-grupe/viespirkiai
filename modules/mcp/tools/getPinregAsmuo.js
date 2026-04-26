import { z } from "zod";
import { gautiPinregDeklaracijasPagalVardaPavarde } from "../../pinreg/pagalVarda.js";

const DEFAULT_LIMIT = 20;

export const name = "get_pinreg_asmuo";
export const description =
    "Grąžina PINREG privačių interesų deklaracijas pagal asmens vardą ir pavardę. Ieško darboviečių, ryšių su juridiniais asmenimis ir sutuoktinių darboviečių.";

export const schema = {
    vardas: z
        .string()
        .describe("Asmens vardas ir pavardė (pvz. 'Jonas Jonaitis')"),
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

export async function handler({ vardas, limit = DEFAULT_LIMIT }) {
    const result = await gautiPinregDeklaracijasPagalVardaPavarde(vardas, {
        limit,
        flat: true,
    });
    return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
    };
}
