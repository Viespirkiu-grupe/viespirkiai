import { describe, expect, it, vi } from "vitest";
import {
    isFailureResult,
    runPirkimoAprasas,
    runSutartiesAprasas,
} from "../modules/viesiejiPirkimai/pirkimoAprasasHarness.js";

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
            pirkimoId: "9330950",
            apiKey: "test-key",
            tools: [pirkimas, failas],
            fetchImpl,
        });

        expect(result).toBe("Perkamas aiškiai aprašytas objektas.");
        expect(pirkimas.handler).toHaveBeenCalledWith({ pirkimoId: "9330950" });
        expect(failas.handler).toHaveBeenCalledWith({ id: 42 });
        const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(firstBody.model).toBe("stealth/ox-alpha");
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
});
