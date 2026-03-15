import { z } from "zod";
import { getJuridinisInfo } from "../../juridiniai/getJuridinisInfo.js";

const limitSchema = z.number().int().min(1).max(50);

export const name = "get_juridinis";
export const description =
    "Grąžina išsamią informaciją apie juridinį asmenį pagal JAR kodą. Apima įmonės duomenis, Sodros statistiką, VMI, sutartis, finansus, PINREG deklaracijas, teismo nuosprendžius ir kt. Duomenys grąžinami su numatytaisiais limitais — nurodykite override parametrus jei reikia daugiau.";

export const schema = {
    jarKodas: z
        .string()
        .regex(/^\d{1,9}$/)
        .describe("Juridinio asmens kodas"),
    sutartysLimit: limitSchema
        .default(5)
        .describe("Sutarčių skaičius (maks. 50)"),
    pinregLimit: limitSchema
        .default(3)
        .describe("PINREG deklaracijų skaičius (maks. 50)"),
    teismoNuosprendziaiLimit: limitSchema
        .default(5)
        .describe("Teismo nuosprendžių skaičius (maks. 50)"),
    regitraLimit: limitSchema
        .default(3)
        .describe("Regitros transporto priemonių skaičius (maks. 50)"),
    darboSkelbimaiLimit: limitSchema
        .default(3)
        .describe("Darbo skelbimų skaičius (maks. 50)"),
    rcPranesimaiLimit: limitSchema
        .default(3)
        .describe("RC pranešimų skaičius (maks. 50)"),
    domenaiLimit: limitSchema.default(3).describe("Domenų skaičius (maks. 50)"),
    kotisLimit: limitSchema
        .default(3)
        .describe("KOTIS įrašų skaičius (maks. 50)"),
    esInvesticijosLimit: limitSchema
        .default(3)
        .describe("ES investicijų įrašų skaičius (maks. 50)"),
    mvpAprasaiLimit: limitSchema
        .default(1)
        .describe("MVP aprašų skaičius (maks. 50)"),
};

export async function handler({
    jarKodas,
    sutartysLimit,
    pinregLimit,
    teismoNuosprendziaiLimit,
    regitraLimit,
    darboSkelbimaiLimit,
    rcPranesimaiLimit,
    domenaiLimit,
    kotisLimit,
    esInvesticijosLimit,
    mvpAprasaiLimit,
}) {
    const result = await getJuridinisInfo(jarKodas, {
        sutartys: { limit: sutartysLimit },
        pinreg: { limit: pinregLimit },
        teismoNuosprendziai: { limit: teismoNuosprendziaiLimit },
        regitra: { limit: regitraLimit },
        darboSkelbimai: { limit: darboSkelbimaiLimit },
        rcPranesimai: { limit: rcPranesimaiLimit },
        domenai: { limit: domenaiLimit },
        kotis: { limit: kotisLimit },
        esInvesticijos: { limit: esInvesticijosLimit },
        mvpAprasai: { limit: mvpAprasaiLimit },
    });

    if (result.error === 404) {
        return {
            content: [
                {
                    type: "text",
                    text: `Juridinis asmuo su kodu ${jarKodas} nerastas.`,
                },
            ],
            isError: true,
        };
    }

    if (result.special) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(
                        {
                            pavadinimas: result.pavadinimas,
                            aprasymas: result.aprasymas,
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    }

    // Drop timings — not useful for Claude
    const { asmuo } = result;

    return {
        content: [{ type: "text", text: JSON.stringify(asmuo, null, 2) }],
    };
}
