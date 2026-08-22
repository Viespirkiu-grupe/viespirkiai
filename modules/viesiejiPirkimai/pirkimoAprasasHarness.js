const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "stealth/ox-alpha";
const DEFAULT_MAX_STEPS = 12;

export function pirkimoAprasoPrompt(pirkimoId) {
    return `Detaliai aprašyk viešojo pirkimo ${pirkimoId} turinį. Prašomas rezultatas – iki 10 sakinių paprastai aiškiai ir tiksliai aprašančių perkamą objektą. Apie patį pirkimą ar pirkėją rašyti nereikia. Sakinių numeruoti nereikia. Prieš rašant privalai perskaityti dokumentus. Tarp sakinių nedėk naujų eilučių, bet reikia skirstyti mintis į pastraipas. Na, tik ne kas sakinį. Galutiniame atsakyme nepasakok, ką darei, kokius dokumentus skaitei ar kaip priėjai prie išvados – pateik tik patį perkamo objekto aprašymą. Jei pirkimo turinio patikimai aprašyti nepavyksta, užbaik darbą ir grąžink tik {"success":false}.`;
}

export function sutartiesAprasoPrompt(sutartiesId) {
    return `Detaliai aprašyk viešojo pirkimo sutarties ${sutartiesId} turinį. Prašomas rezultatas – iki 10 sakinių paprastai, aiškiai ir tiksliai aprašančių sutartimi perkamą objektą, jo apimtį ir esminius reikalavimus. Apie pačią sutartį, pirkėją, tiekėją ar kainą rašyti nereikia. Sakinių numeruoti nereikia. Prieš rašant privalai perskaityti dokumentus. Tarp sakinių nedėk naujų eilučių, bet susijusias mintis skirstyk į kelias pastraipas, tik ne po vieną sakinį. Galutiniame atsakyme nepasakok, ką darei, kokius dokumentus skaitei ar kaip priėjai prie išvados – pateik tik patį perkamo objekto aprašymą. Jei sutarties turinio patikimai aprašyti nepavyksta, užbaik darbą ir grąžink tik {"success":false}.`;
}

export function isFailureResult(text) {
    const trimmed = String(text ?? "").trim();
    const json = trimmed.startsWith("```")
        ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
        : trimmed;
    try {
        return JSON.parse(json)?.success === false;
    } catch {
        return false;
    }
}

function toolResultText(result) {
    if (!Array.isArray(result?.content)) return JSON.stringify(result ?? null);
    return result.content
        .map((item) => item?.type === "text" ? item.text : JSON.stringify(item))
        .join("\n");
}

function assistantMessage(message) {
    const result = {
        role: "assistant",
        content: message.content ?? null,
    };
    if (message.tool_calls) result.tool_calls = message.tool_calls;
    if (message.reasoning) result.reasoning = message.reasoning;
    // OpenRouter prašo reasoning detales nepakeistas grąžinti kitame agento žingsnyje.
    if (message.reasoning_details) result.reasoning_details = message.reasoning_details;
    return result;
}

function errorMessage(status, body) {
    const message = body?.error?.message || body?.message;
    return `OpenRouter klaida (${status})${message ? `: ${message}` : ""}`;
}

function reasoningText(detail) {
    return detail?.text ?? detail?.summary ?? (detail?.data ? "[užšifruotas reasoning blokas]" : "");
}

function mergeToolCall(toolCalls, delta) {
    const index = delta.index ?? 0;
    const current = toolCalls[index] ?? {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
    };
    if (delta.id) current.id = delta.id;
    if (delta.type) current.type = delta.type;
    if (delta.function?.name) current.function.name += delta.function.name;
    if (delta.function?.arguments) current.function.arguments += delta.function.arguments;
    toolCalls[index] = current;
}

async function readSse(response, onEvent) {
    if (!response.body) throw new Error("OpenRouter negrąžino SSE atsakymo body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let reasoning = "";
    const reasoningDetails = [];
    const toolCalls = [];

    const processEvent = (rawEvent) => {
        const comments = rawEvent
            .split(/\r?\n/)
            .filter((line) => line.startsWith(":"))
            .map((line) => line.slice(1).trim())
            .filter(Boolean);
        for (const comment of comments) onEvent({ type: "heartbeat", text: comment });

        const data = rawEvent
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
        if (!data || data === "[DONE]") return;

        let chunk;
        try {
            chunk = JSON.parse(data);
        } catch {
            throw new Error(`OpenRouter grąžino netaisyklingą SSE JSON: ${data}`);
        }
        if (chunk.error) throw new Error(errorMessage(chunk.error.code ?? 500, chunk));

        if (chunk.usage) onEvent({ type: "usage", usage: chunk.usage });
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) {
            onEvent({ type: "finish", reason: choice.finish_reason });
        }
        const delta = choice?.delta;
        if (!delta) return;
        if (typeof delta.reasoning === "string" && delta.reasoning) {
            reasoning += delta.reasoning;
            if (!delta.reasoning_details?.length) {
                onEvent({ type: "reasoning_delta", text: delta.reasoning });
            }
        }
        for (const detail of delta.reasoning_details ?? []) {
            reasoningDetails.push(detail);
            const text = reasoningText(detail);
            onEvent({ type: "reasoning_detail", detail, text });
        }
        if (typeof delta.content === "string" && delta.content) {
            content += delta.content;
            onEvent({ type: "content_delta", text: delta.content });
        }
        for (const toolCall of delta.tool_calls ?? []) {
            mergeToolCall(toolCalls, toolCall);
            onEvent({ type: "tool_call_delta", delta: toolCall });
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        for (const event of events) processEvent(event);
        if (done) break;
    }
    if (buffer.trim()) processEvent(buffer);

    const message = { role: "assistant", content: content || null };
    if (reasoning) message.reasoning = reasoning;
    if (reasoningDetails.length) message.reasoning_details = reasoningDetails;
    if (toolCalls.length) message.tool_calls = toolCalls.filter(Boolean);
    return message;
}

async function responseError(response) {
    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new Error(`OpenRouter grąžino ne JSON klaidą (${response.status}).`);
    }
    return errorMessage(response.status, payload);
}

async function requestCompletion({ apiKey, body, fetchImpl, onEvent, beforeRequest }) {
    for (let attempt = 0; attempt < 3; attempt++) {
        await beforeRequest();
        const response = await fetchImpl(OPENROUTER_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120_000),
        });

        if (!response.ok) {
            if ((response.status === 429 || response.status === 502) && attempt < 2) {
                onEvent({ type: "retry", status: response.status, attempt: attempt + 1 });
                await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
                continue;
            }
            throw new Error(await responseError(response));
        }
        return readSse(response, onEvent);
    }
}

/**
 * Minimalus OpenRouter tool-calling ciklas. `tools` yra jau prie MCP modulių
 * prijungti adapteriai: { definition, validate, handler }.
 */
export async function runPirkimoAprasas({
    pirkimoId,
    apiKey,
    tools,
    fetchImpl = fetch,
    onToolCall = () => {},
    onEvent = () => {},
    model = DEFAULT_MODEL,
    reasoningEffort = "max",
    maxOutputTokens = 4000,
    temperature,
    topP,
    topK,
    maxSteps = DEFAULT_MAX_STEPS,
    beforeRequest = async () => {},
    promptFactory = pirkimoAprasoPrompt,
    firstToolName = "get_viesasis_pirkimas",
    firstToolReminder = "Dar neperskaitei pirkimo duomenų. Naudok get_viesasis_pirkimas su pateiktu numeriu ir tik tada tęsk.",
    documentReminder = "Dar neįvykdei reikalavimo perskaityti pirkimo dokumentus. Pirmiausia naudok get_failas pasirinktiems turinį apibrėžiantiems dokumentams, o prireikus – get_failas_tekstas. Tik tada pateik galutinį aprašymą.",
}) {
    if (!apiKey) throw new Error("Nenustatytas OPENROUTER_API_KEY.");
    if (!/^\d+$/.test(String(pirkimoId ?? ""))) {
        throw new Error("Pirkimo numeris turi būti sudarytas iš skaitmenų.");
    }

    const toolMap = new Map(tools.map((tool) => [tool.definition.function.name, tool]));
    if (!toolMap.has(firstToolName)) {
        throw new Error(`Trūksta privalomo ${firstToolName} įrankio.`);
    }
    const messages = [{ role: "user", content: promptFactory(String(pirkimoId)) }];
    let objektasPerskaitytas = false;
    let dokumentasPerskaitytas = false;

    for (let step = 0; step < maxSteps; step++) {
        onEvent({ type: "step_start", step: step + 1 });
        const message = await requestCompletion({
            apiKey,
            fetchImpl,
            onEvent,
            beforeRequest,
            body: {
                model,
                messages,
                tools: tools.map((tool) => tool.definition),
                tool_choice: step === 0
                    ? { type: "function", function: { name: firstToolName } }
                    : "auto",
                stream: true,
                stream_options: { include_usage: true },
                reasoning: reasoningEffort
                    ? { effort: reasoningEffort, exclude: false }
                    : undefined,
                max_tokens: maxOutputTokens,
                temperature,
                top_p: topP,
                top_k: topK,
            },
        });
        messages.push(assistantMessage(message));

        const calls = message.tool_calls ?? [];
        if (!calls.length) {
            const text = typeof message.content === "string" ? message.content.trim() : "";
            if (!text) throw new Error("Modelis negrąžino nei teksto, nei įrankio kvietimo.");

            // Sąmoninga modelio baigtis, kai pirkimo ar dokumentų nepakanka.
            // Ją priimame ir be sėkmingo dokumento perskaitymo, kad toks
            // pirkimas nebūtų be galo kartojamas batch režime.
            if (isFailureResult(text)) return '{"success":false}';

            // Promptas reikalauja dokumentus perskaityti, todėl nepriimame
            // ankstyvo atsakymo po vien pirkimo metaduomenų peržiūros.
            if (!objektasPerskaitytas || !dokumentasPerskaitytas) {
                messages.push({
                    role: "user",
                    content: !objektasPerskaitytas
                        ? firstToolReminder
                        : documentReminder,
                });
                continue;
            }
            return text;
        }

        for (const call of calls) {
            const name = call?.function?.name;
            const tool = toolMap.get(name);
            let result;

            if (!tool) {
                result = { isError: true, content: [{ type: "text", text: `Nežinomas įrankis: ${name}` }] };
            } else {
                let args;
                try {
                    args = JSON.parse(call.function.arguments || "{}");
                    args = tool.validate(args);
                    onToolCall(name, args);
                    onEvent({ type: "tool_start", name, args, id: call.id });
                    result = await tool.handler(args);
                } catch (error) {
                    result = {
                        isError: true,
                        content: [{ type: "text", text: `Įrankio klaida: ${error.message}` }],
                    };
                }
            }

            const resultText = toolResultText(result);
            onEvent({
                type: "tool_result",
                name,
                id: call.id,
                isError: result?.isError === true,
                text: resultText,
            });

            if (!result?.isError && name === firstToolName) objektasPerskaitytas = true;
            if (!result?.isError && (name === "get_failas" || name === "get_failas_tekstas")) {
                dokumentasPerskaitytas = true;
            }
            messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: resultText,
            });
        }
    }

    throw new Error(`Modelis nebaigė darbo per ${maxSteps} žingsnių.`);
}

export function runSutartiesAprasas({ sutartiesId, ...options }) {
    return runPirkimoAprasas({
        ...options,
        pirkimoId: String(sutartiesId),
        promptFactory: sutartiesAprasoPrompt,
        firstToolName: "get_sutartis",
        firstToolReminder: "Dar neperskaitei sutarties duomenų. Naudok get_sutartis su pateiktu ID ir tik tada tęsk.",
        documentReminder: "Dar neįvykdei reikalavimo perskaityti sutarties dokumentus. Pirmiausia naudok get_failas pasirinktiems turinį apibrėžiantiems dokumentams, o prireikus – get_failas_tekstas. Tik tada pateik galutinį aprašymą.",
    });
}
