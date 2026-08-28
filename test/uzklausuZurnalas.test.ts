import { describe, expect, it } from "vitest";
import {
    dydis,
    kaina,
    sukurtiSuvestine,
    uzklausuZurnalas,
    zingsnioSantrauka,
} from "../modules/viesiejiPirkimai/uzklausuZurnalas.js";

function usage(over: any = {}) {
    return {
        prompt_tokens: 12000,
        completion_tokens: 4000,
        cost: 0.0031,
        prompt_tokens_details: { cached_tokens: 3000 },
        completion_tokens_details: { reasoning_tokens: 400 },
        ...over,
    };
}

describe("užklausų žurnalo skaičiavimai", () => {
    it("atskiria reasoning nuo matomo atsakymo", () => {
        // OpenRouter `completion_tokens` jau apima reasoning – žurnalas turi
        // parodyti, kiek liko pačiam atsakymui.
        const s = zingsnioSantrauka(usage({
            completion_tokens_details: { reasoning_tokens: 4000 },
        }));

        expect(s.reasoning).toBe(4000);
        expect(s.atsakymas).toBe(0);
        expect(s.cacheProc).toBe(25);
    });

    it("nesugriūva ant tuščio usage bloko", () => {
        expect(zingsnioSantrauka(undefined)).toMatchObject({
            promptTokens: 0, cached: 0, cacheProc: 0, kaina: 0,
        });
    });

    it("smulkios kainos nesuapvalinamos iki nulio", () => {
        expect(kaina(0.00013925)).toBe("$0.00014");
        expect(kaina(0)).toBe("$0");
        expect(kaina(1.5)).toBe("$1.5000");
    });

    it("dydžius rodo žmogui", () => {
        expect(dydis(512)).toBe("512 B");
        expect(dydis(2048)).toBe("2.0 KB");
        expect(dydis(5 * 1024 * 1024)).toBe("5.00 MB");
    });
});

describe("užklausų žurnalas", () => {
    it("logina dydžius ir kainą, bet ne turinį", () => {
        const eilutes: string[] = [];
        const { onEvent, savi } = uzklausuZurnalas({
            zyme: 9380006,
            rasyk: (text) => eilutes.push(text),
        });

        onEvent({ type: "step_start", step: 2 });
        onEvent({
            type: "request",
            model: "z-ai/glm-5.3-flash",
            zinutes: 5,
            baitai: 2048,
            maxTokens: 4000,
            toolChoice: "auto",
        });
        onEvent({ type: "tool_start", name: "get_failas", args: { id: 42 } });
        onEvent({
            type: "tool_result",
            name: "get_failas",
            isError: false,
            text: "SLAPTAS DOKUMENTO TURINYS".repeat(100),
        });
        onEvent({ type: "finish", reason: "tool_calls" });
        onEvent({ type: "usage", usage: usage() });

        const visas = eilutes.join("\n");
        expect(visas).toContain("2.0 KB");
        expect(visas).toContain("prompt 12000");
        expect(visas).toContain("cache 3000, 25%");
        expect(visas).toContain("reasoning 400");
        expect(visas).toContain("tool_calls");
        expect(visas).toContain('get_failas {"id":42}');
        // Turinys neturi patekti į logą jokia forma – tik jo ilgis.
        expect(visas).not.toContain("SLAPTAS");
        expect(visas).toContain("grąžinta 2.4 KB");
        expect(savi).toMatchObject({ uzklausu: 1, promptTokenu: 12000, kaina: 0.0031 });
    });

    it("tyliu režimu nieko nerašo, bet sąskaitą kaupia", () => {
        const eilutes: string[] = [];
        const suvestine = sukurtiSuvestine();
        const { onEvent } = uzklausuZurnalas({
            zyme: 1,
            rasyk: (text) => eilutes.push(text),
            tylus: true,
            suvestine,
        });

        onEvent({ type: "step_start", step: 1 });
        onEvent({ type: "request", model: "m", zinutes: 1, baitai: 10, maxTokens: 1, toolChoice: "auto" });
        onEvent({ type: "usage", usage: usage() });
        onEvent({ type: "usage", usage: usage() });

        expect(eilutes).toHaveLength(0);
        expect(suvestine.viso).toMatchObject({ uzklausu: 2, prompt: 24000 });
        expect(suvestine.eilute()).toContain("$0.0062");
    });
});
