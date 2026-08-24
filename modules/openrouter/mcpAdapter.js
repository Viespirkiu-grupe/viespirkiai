import { z } from "zod";

/**
 * MCP įrankio modulis → OpenRouter tool-loop įrankis.
 *
 * MCP įrankiai (`modules/mcp/tools/*.js`) schemą aprašo zod objektu; OpenRouter
 * nori JSON Schema. Čia gyvena vertimas, kad aprašymų generavimo keliai
 * (scripts/aprasyti*.js, modules/viesiejiPirkimai/aprasymoGeneravimas.js)
 * nedubliuotų to paties adapterio.
 *
 * @param {{ name: string, description: string, schema: object, handler: Function }} module
 */
export function mcpAdapter(module) {
    const inputSchema = z.object(module.schema);
    const jsonSchema = z.toJSONSchema(inputSchema);
    delete jsonSchema.$schema;

    return {
        definition: {
            type: "function",
            function: {
                name: module.name,
                description: module.description,
                parameters: jsonSchema,
            },
        },
        validate: (args) => inputSchema.parse(args),
        handler: module.handler,
    };
}
