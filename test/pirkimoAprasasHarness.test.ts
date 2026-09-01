import { describe, expect, it, vi } from "vitest";
import {
    AprasoKlaida,
    isFailureResult,
    runPirkimoAprasas,
    runSutartiesAprasas,
} from "../modules/viesiejiPirkimai/pirkimoAprasasHarness.js";
import {
    pazymetiAprasymoRezultata,
} from "../modules/viesiejiPirkimai/aprasymuEile.js";

function response(message: any) {
    const deltas = [];
    if (message.reasoning) {
        deltas.push({ reasoning: message.reasoning });
    }
    if (message.reasoning_details) {
        deltas.push({ reasoning_details: message.reasoning_details });
    }
    if (message.content) {
        const middle = Math.ceil(message.content.length / 2);
        deltas.push({ content: message.content.slice(0, middle) });
        deltas.push({ content: message.content.slice(middle) });
    }
    if (message.tool_calls) {
        deltas.push({ tool_calls: message.tool_calls.map((call: any, index: number) => ({
            index,
            id: call.id,
            type: call.type,
            function: call.function,
        })) });
    }
    const sse = ": OPENROUTER PROCESSING\n\n" + deltas
        .map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
        .join("")
        + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] })}\n\n`
        + `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 10, cost: 0.001 } })}\n\n`
        + "data: [DONE]\n\n";
    return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
    });
}

/** SSE atsakymas be teksto ir be įrankių, nutrūkęs ties `max_tokens`. */
function truncatedResponse() {
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "mąstau…" } }] })}\n\n`
        + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`
        + "data: [DONE]\n\n";
    return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
    });
}

function errorResponse(status: number, message: string) {
    return new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function fakeTool(name: string) {
    return {
        definition: {
            type: "function",
            function: { name, description: name, parameters: { type: "object" } },
        },
        validate: (args: unknown) => args,
        handler: vi.fn(async () => ({ content: [{ type: "text", text: `${name} rezultatas` }] })),
    };
}

describe("pirkimo aprašo OpenRouter harness", () => {
    it("atpažįsta modelio nesėkmės rezultatą", () => {
        expect(isFailureResult('{"success":false}')).toBe(true);
        expect(isFailureResult("Normalus aprašymas.")).toBe(false);
    });

    it("priima success=false, kai dokumentų perskaityti nepavyko", async () => {
        const pirkimas = fakeTool("get_viesasis_pirkimas");
        pirkimas.handler.mockResolvedValueOnce({
            isError: true,
            content: [{ type: "text", text: "Pirkimas nerastas" }],
        });
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({
                tool_calls: [{ id: "p1", type: "function", function: { name: "get_viesasis_pirkimas", arguments: '{"pirkimoId":"1"}' } }],
            }))
            .mockResolvedValueOnce(response({ content: '{"success":false}' }));

        await expect(runPirkimoAprasas({
            model: "testas/modelis",
            pirkimoId: "1",
            apiKey: "test-key",
            tools: [pirkimas],
            fetchImpl,
        })).resolves.toBe('{"success":false}');
    });

    it("vykdo MCP įrankių ciklą ir neperduoda analitikos įrankių", async () => {
        const pirkimas = fakeTool("get_viesasis_pirkimas");
        const failas = fakeTool("get_failas");
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({
                role: "assistant",
                content: null,
                tool_calls: [{ id: "p1", type: "function", function: { name: pirkimas.definition.function.name, arguments: '{"pirkimoId":"9330950"}' } }],
            }))
            .mockResolvedValueOnce(response({
                role: "assistant",
                content: null,
                tool_calls: [{ id: "f1", type: "function", function: { name: failas.definition.function.name, arguments: '{"id":42}' } }],
            }))
            .mockResolvedValueOnce(response({ role: "assistant", content: "Perkamas aiškiai aprašytas objektas." }));

        const result = await runPirkimoAprasas({
            model: "testas/modelis",
            pirkimoId: "9330950",
            apiKey: "test-key",
            tools: [pirkimas, failas],
            fetchImpl,
        });

        expect(result).toBe("Perkamas aiškiai aprašytas objektas.");
        expect(pirkimas.handler).toHaveBeenCalledWith({ pirkimoId: "9330950" });
        expect(failas.handler).toHaveBeenCalledWith({ id: 42 });
        const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(firstBody.model).toBe("testas/modelis");
        expect(firstBody.stream).toBe(true);
        expect(firstBody.stream_options).toEqual({ include_usage: true });
        expect(firstBody.reasoning).toEqual({ effort: "max", exclude: false });
        expect(firstBody.tool_choice.function.name).toBe("get_viesasis_pirkimas");
        expect(firstBody.tools.map((tool: any) => tool.function.name)).toEqual([
            "get_viesasis_pirkimas",
            "get_failas",
        ]);
    });

    it("gyvai perduoda reasoning, teksto ir įrankių įvykius", async () => {
        const pirkimas = fakeTool("get_viesasis_pirkimas");
        const failas = fakeTool("get_failas");
        const onEvent = vi.fn();
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({
                reasoning: "Tikrinamas pirkimas. ",
                reasoning_details: [{ type: "reasoning.text", text: "Skaitau duomenis. ", index: 0 }],
                tool_calls: [{ id: "p1", type: "function", function: { name: "get_viesasis_pirkimas", arguments: '{"pirkimoId":"1"}' } }],
            }))
            .mockResolvedValueOnce(response({
                tool_calls: [{ id: "f1", type: "function", function: { name: "get_failas", arguments: '{"id":7}' } }],
            }))
            .mockResolvedValueOnce(response({ content: "Galutinis tekstas." }));

        await runPirkimoAprasas({
            model: "testas/modelis",
            pirkimoId: "1",
            apiKey: "test-key",
            tools: [pirkimas, failas],
            fetchImpl,
            onEvent,
        });

        expect(onEvent).toHaveBeenCalledWith({ type: "reasoning_delta", text: "Tikrinamas pirkimas. " });
        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "reasoning_detail", text: "Skaitau duomenis. " }));
        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "content_delta" }));
        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "tool_start", name: "get_failas" }));
        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "tool_result", name: "get_failas" }));
        expect(onEvent).toHaveBeenCalledWith({ type: "heartbeat", text: "OPENROUTER PROCESSING" });
        expect(onEvent).toHaveBeenCalledWith({ type: "finish", reason: "stop" });
        expect(onEvent).toHaveBeenCalledWith({
            type: "usage",
            usage: { total_tokens: 10, cost: 0.001 },
        });
    });

    it("nepriima galutinio atsakymo neperskaičius dokumento", async () => {
        const pirkimas = fakeTool("get_viesasis_pirkimas");
        const failas = fakeTool("get_failas");
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({
                role: "assistant",
                content: null,
                tool_calls: [{ id: "p1", type: "function", function: { name: pirkimas.definition.function.name, arguments: '{"pirkimoId":"1"}' } }],
            }))
            .mockResolvedValueOnce(response({ role: "assistant", content: "Per anksti." }))
            .mockResolvedValueOnce(response({
                role: "assistant",
                content: null,
                tool_calls: [{ id: "f1", type: "function", function: { name: failas.definition.function.name, arguments: '{"id":7}' } }],
            }))
            .mockResolvedValueOnce(response({ role: "assistant", content: "Galutinis tekstas." }));

        await expect(runPirkimoAprasas({
            model: "testas/modelis",
            pirkimoId: "1",
            apiKey: "test-key",
            tools: [pirkimas, failas],
            fetchImpl,
        })).resolves.toBe("Galutinis tekstas.");

        const reminderBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
        expect(reminderBody.messages.at(-1).content).toContain("Dar neįvykdei reikalavimo");
    });

    it("sutarties aprašymui perskaito sutartį ir jos dokumentą", async () => {
        const sutartis = fakeTool("get_sutartis");
        const failas = fakeTool("get_failas");
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({
                tool_calls: [{ id: "s1", type: "function", function: { name: "get_sutartis", arguments: '{"id":123}' } }],
            }))
            .mockResolvedValueOnce(response({
                tool_calls: [{ id: "f1", type: "function", function: { name: "get_failas", arguments: '{"id":42}' } }],
            }))
            .mockResolvedValueOnce(response({ content: "Sutartimi perkamos aprašytos paslaugos." }));

        await expect(runSutartiesAprasas({
            model: "testas/modelis",
            sutartiesId: "123",
            apiKey: "test-key",
            tools: [sutartis, failas],
            fetchImpl,
        })).resolves.toBe("Sutartimi perkamos aprašytos paslaugos.");

        expect(sutartis.handler).toHaveBeenCalledWith({ id: 123 });
        expect(failas.handler).toHaveBeenCalledWith({ id: 42 });
        const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(firstBody.tool_choice.function.name).toBe("get_sutartis");
    });
    it("reikalauja aiškaus modelio — numatytojo nebėra", async () => {
        await expect(runPirkimoAprasas({
            pirkimoId: "1",
            apiKey: "test-key",
            tools: [fakeTool("get_viesasis_pirkimas")],
            fetchImpl: vi.fn(),
        })).rejects.toMatchObject({
            infrastrukturine: true,
            message: expect.stringContaining("Nenurodytas modelis"),
        });
    });

    it("dingusį modelį pažymi kaip aplinkos, o ne pirkimo klaidą", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            errorResponse(404, "This model was ZAI's GLM-5.3 Flash."),
        );

        const klaida = await runPirkimoAprasas({
            model: "stealth/ox-alpha",
            pirkimoId: "1",
            apiKey: "test-key",
            tools: [fakeTool("get_viesasis_pirkimas")],
            fetchImpl,
        }).catch((error) => error);

        expect(klaida).toBeInstanceOf(AprasoKlaida);
        expect(klaida.infrastrukturine).toBe(true);
        expect(klaida.message).toContain("404");
    });

    it("iš tiekėjo klaidos ištraukia raw priežastį", async () => {
        // „Provider returned error" pats savaime nieko nesako – reikia metadata.
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            error: {
                message: "Provider returned error",
                code: 400,
                metadata: {
                    provider_name: "Z.AI",
                    raw: "{\"error\":{\"message\":\"context length 1400000 exceeds limit\"}}",
                },
            },
        }), { status: 400, headers: { "Content-Type": "application/json" } }));

        const klaida = await runPirkimoAprasas({
            model: "testas/modelis",
            pirkimoId: "1",
            apiKey: "test-key",
            tools: [fakeTool("get_viesasis_pirkimas")],
            fetchImpl,
        }).catch((error) => error);

        expect(klaida.message).toContain("Provider returned error");
        expect(klaida.message).toContain("tiekėjas: Z.AI");
        expect(klaida.message).toContain("context length 1400000 exceeds limit");
        // 400 kartosis su tuo pačiu pirkimu, tad bandymus degina.
        expect(klaida.infrastrukturine).toBe(false);
    });

    it("tiekėjui atmetus tool_choice nusileidžia iki \"auto\"", async () => {
        const pirkimas = fakeTool("get_viesasis_pirkimas");
        const failas = fakeTool("get_failas");
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                error: {
                    message: "only `\"auto\"` is supported for `tool_choice`.",
                    metadata: { provider_name: "Meta" },
                },
            }), { status: 400, headers: { "Content-Type": "application/json" } }))
            .mockResolvedValueOnce(response({
                tool_calls: [{ id: "p1", type: "function", function: { name: "get_viesasis_pirkimas", arguments: '{"pirkimoId":"1"}' } }],
            }))
            .mockResolvedValueOnce(response({
                tool_calls: [{ id: "f1", type: "function", function: { name: "get_failas", arguments: '{"id":7}' } }],
            }))
            .mockResolvedValueOnce(response({ content: "Galutinis tekstas." }));

        await expect(runPirkimoAprasas({
            model: "testas/modelis",
            pirkimoId: "1",
            apiKey: "test-key",
            tools: [pirkimas, failas],
            fetchImpl,
        })).resolves.toBe("Galutinis tekstas.");

        // Pirmas bandymas – priverstinis įrankis, antras – jau "auto".
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).tool_choice)
            .toEqual({ type: "function", function: { name: "get_viesasis_pirkimas" } });
        expect(JSON.parse(fetchImpl.mock.calls[1][1].body).tool_choice).toBe("auto");
        // Vartai išlieka: pirkimas ir dokumentas vis tiek perskaityti.
        expect(pirkimas.handler).toHaveBeenCalled();
        expect(failas.handler).toHaveBeenCalled();
    });

    it("tuščią atsakymą dėl išnaudoto biudžeto paaiškina ir laiko pirkimo klaida", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(truncatedResponse());

        const klaida = await runPirkimoAprasas({
            model: "testas/modelis",
            pirkimoId: "1",
            apiKey: "test-key",
            tools: [fakeTool("get_viesasis_pirkimas")],
            fetchImpl,
            maxOutputTokens: 4000,
        }).catch((error) => error);

        expect(klaida.infrastrukturine).toBeFalsy();
        expect(klaida.message).toContain("4000");
        expect(klaida.message).toContain("maxOutputTokens");
    });
});

describe("aprašymų eilės klaidų apskaita", () => {
    function fakeKlientas() {
        const queries: Array<{ text: string, values: any[] }> = [];
        return {
            queries,
            query: async (text: string, values: any[] = []) => {
                queries.push({ text, values });
                return { rowCount: 1, rows: [] };
            },
        };
    }

    it("aplinkos klaida nedidina attempts — tik atideda", async () => {
        const klientas = fakeKlientas();
        await pazymetiAprasymoRezultata(
            1,
            new AprasoKlaida("OpenRouter klaida (404)", { infrastrukturine: true }),
            klientas as any,
        );

        expect(klientas.queries).toHaveLength(1);
        expect(klientas.queries[0].text).not.toContain("attempts");
        expect(klientas.queries[0].text).toContain("nextAttempt");
    });

    it("pirkimo klaida didina attempts", async () => {
        const klientas = fakeKlientas();
        await pazymetiAprasymoRezultata(1, new Error("Modelis nebaigė darbo"), klientas as any);

        expect(klientas.queries[0].text).toContain("attempts      = attempts + 1");
    });

    it("sėkmė išima eilutę iš eilės", async () => {
        const klientas = fakeKlientas();
        await pazymetiAprasymoRezultata(1, null, klientas as any);

        expect(klientas.queries[0].text).toContain("DELETE FROM");
    });
});
