const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MAX_STEPS = 12;

/*
Numatytojo modelio čia SĄMONINGAI nėra.

Anksčiau buvo `DEFAULT_MODEL = "stealth/ox-alpha"`. Kai OpenRouter tą stealth
alias'ą pašalino, kodas liko rodyti į nebeegzistuojantį modelį, o vienintelė
vieta, kur modelis iš tikrųjų tvarkomas (`ai."paskirtys"` DB lentelė), apie
tai nieko nežinojo. Modelį privalo perduoti kviečiantysis — žr.
`modules/openrouter/modelioVariantai.js` (`getPaskirtis` + `apiModel`).
*/

/**
 * Aprašymo klaida su požymiu, ar ji YRA šio pirkimo kaltė.
 *
 * `infrastrukturine = true` reiškia „ne pirkimo, o aplinkos bėda": modelio
 * nebėra, pasibaigė kreditai, nukrito tinklas, blogas raktas. Tokios klaidos
 * NETURI deginti pirkimo bandymų (`attempts`) — priešingu atveju vienas
 * modelio dingimas per kelias valandas negrįžtamai užmuša visą eilės backlog'ą
 * (taip 2026-08-26 mirė 114 eilučių). Eilė tokias eilutes tik atideda.
 */
export class AprasoKlaida extends Error {
    constructor(message, { infrastrukturine = false } = {}) {
        super(message);
        this.name = "AprasoKlaida";
        this.infrastrukturine = infrastrukturine;
    }
}

/** Aplinkos (ne pirkimo) klaida — eilė dėl jos nedidina `attempts`. */
function infraKlaida(message) {
    return new AprasoKlaida(message, { infrastrukturine: true });
}

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

/*
OpenRouter klaidos tekstas su tiekėjo detalėmis.

`error.message` dažnai būna beverčio „Provider returned error" pavidalo –
tikroji priežastis (konteksto limitas, blogas parametras, tiekėjo gedimas)
guli `error.metadata.raw`, kur įdėtas neapdorotas tiekėjo atsakymas. Be jo
`lastError` eilėje nieko nepasako ir klaidos neįmanoma taisyti.
*/
function errorMessage(status, body) {
    const error = body?.error ?? body;
    const dalys = [];
    const message = error?.message || body?.message;
    if (message) dalys.push(message);

    const meta = error?.metadata;
    if (meta?.provider_name) dalys.push(`tiekėjas: ${meta.provider_name}`);
    if (meta?.reasons?.length) dalys.push(`priežastys: ${meta.reasons.join(", ")}`);

    const raw = meta?.raw;
    if (raw) {
        const tekstas = typeof raw === "string" ? raw : JSON.stringify(raw);
        dalys.push(`raw: ${tekstas.replace(/\s+/g, " ").slice(0, 400)}`);
    } else if (meta && !meta.provider_name) {
        dalys.push(`metadata: ${JSON.stringify(meta).slice(0, 400)}`);
    }

    if (error?.code && error.code !== status) dalys.push(`code: ${error.code}`);

    return `OpenRouter klaida (${status})${dalys.length ? `: ${dalys.join(" · ")}` : ""}`;
}

/*
Ar HTTP statusas reiškia aplinkos bėdą?

400 – NE: tai priekaištas pačiai užklausai (per ilgas kontekstas, tiekėjui
netinkamas parametras), tad kartojasi kiekvieną kartą su tuo pačiu pirkimu.
Laikom pirkimo klaida, kad degintų `attempts` ir po penkių bandymų nustotų —
kitaip eilutė kas 15 min. amžinai kartotų tą pačią apmokamą užklausą.

Visa kita (401/402/403/404, 429, 5xx) – aplinka: raktas, kreditai, dingęs
modelis, tiekėjo gedimas. Šitos praeina pačios ir bandymų deginti neturi.
*/
function arAplinkosStatusas(status) {
    return status !== 400;
}

/*
Ar tiekėjas atmetė priverstinį `tool_choice`?

Dalis tiekėjų (per OpenRouter matyti bent Meta) palaiko tik
`tool_choice: "auto"` ir konkretaus įrankio reikalavimą atmeta su 400. Tas pats
modelio pavadinimas gali būti aptarnaujamas skirtingų tiekėjų, tad tai nėra
nuspėjama iš anksto — belieka pabandyti ir, gavus šitą klaidą, nusileisti iki
`"auto"`.

Aprašymo teisingumui tai nekenkia: reikalavimą pirma perskaityti pirkimą ir
dokumentus saugo `objektasPerskaitytas` / `dokumentasPerskaitytas` vartai, kurie
neleidžia priimti galutinio atsakymo be jų. `tool_choice` buvo tik spartesnis
kelias į tą patį.
*/
function arNepalaikomasToolChoice(klaida) {
    return /tool_choice/i.test(klaida?.message ?? "");
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
    if (!response.body) throw infraKlaida("OpenRouter negrąžino SSE atsakymo body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let reasoning = "";
    let finishReason = null;
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
            throw infraKlaida(`OpenRouter grąžino netaisyklingą SSE JSON: ${data}`);
        }
        if (chunk.error) {
            const status = chunk.error.code ?? 500;
            throw new AprasoKlaida(errorMessage(status, chunk), {
                infrastrukturine: arAplinkosStatusas(status),
            });
        }

        if (chunk.usage) onEvent({ type: "usage", usage: chunk.usage });
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
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

    // `finishReason` lieka tik vidiniam naudojimui — `assistantMessage` į
    // OpenRouter siunčiamą žinutę perkelia tik content/tool_calls/reasoning.
    const message = { role: "assistant", content: content || null, finishReason };
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
        throw infraKlaida(`OpenRouter grąžino ne JSON klaidą (${response.status}).`);
    }
    return errorMessage(response.status, payload);
}

async function requestCompletion({ apiKey, body, fetchImpl, onEvent, beforeRequest }) {
    /*
    Kiekviena užklausa paskelbiama PRIEŠ išsiuntimą — su dydžiais, be turinio.

    Kaina auga ne nuo žingsnių skaičiaus, o nuo to, kad kiekvienas žingsnis iš
    naujo siunčia visą ligtolinį pokalbį su dokumentų tekstais. `zinutes` ir
    `baitai` leidžia tai pamatyti nelaukiant sąskaitos ir nesirausiant po
    dokumentų turinį (žr. `npm run pirkimas:auditas`).
    */
    const payload = JSON.stringify(body);
    onEvent({
        type: "request",
        model: body.model,
        zinutes: body.messages.length,
        baitai: Buffer.byteLength(payload),
        maxTokens: body.max_tokens,
        toolChoice: typeof body.tool_choice === "string"
            ? body.tool_choice
            : body.tool_choice?.function?.name,
    });

    for (let attempt = 0; attempt < 3; attempt++) {
        await beforeRequest();
        const response = await fetchImpl(OPENROUTER_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: payload,
            signal: AbortSignal.timeout(120_000),
        });

        if (!response.ok) {
            if ((response.status === 429 || response.status === 502) && attempt < 2) {
                onEvent({ type: "retry", status: response.status, attempt: attempt + 1 });
                await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
                continue;
            }
            throw new AprasoKlaida(await responseError(response), {
                infrastrukturine: arAplinkosStatusas(response.status),
            });
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
    model,
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
    if (!apiKey) throw infraKlaida("Nenustatytas OPENROUTER_API_KEY.");
    if (!model) {
        throw infraKlaida(
            "Nenurodytas modelis. Jį reikia paimti iš `ai.\"paskirtys\"`"
            + " (getPaskirtis + apiModel), o ne pasikliauti numatytąja reikšme.",
        );
    }
    if (!/^\d+$/.test(String(pirkimoId ?? ""))) {
        throw new Error("Pirkimo numeris turi būti sudarytas iš skaitmenų.");
    }

    const toolMap = new Map(tools.map((tool) => [tool.definition.function.name, tool]));
    if (!toolMap.has(firstToolName)) {
        throw infraKlaida(`Trūksta privalomo ${firstToolName} įrankio.`);
    }
    const messages = [{ role: "user", content: promptFactory(String(pirkimoId)) }];
    let objektasPerskaitytas = false;
    let dokumentasPerskaitytas = false;

    // Nusileidžiama į `"auto"`, jei tiekėjas priverstinio įrankio nepalaiko.
    let priverstinisPirmasIrankis = true;

    const kurtiBody = (step) => ({
        model,
        messages,
        tools: tools.map((tool) => tool.definition),
        tool_choice: step === 0 && priverstinisPirmasIrankis
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
    });

    for (let step = 0; step < maxSteps; step++) {
        onEvent({ type: "step_start", step: step + 1 });
        let message;
        try {
            message = await requestCompletion({
                apiKey,
                fetchImpl,
                onEvent,
                beforeRequest,
                body: kurtiBody(step),
            });
        } catch (error) {
            if (!priverstinisPirmasIrankis || !arNepalaikomasToolChoice(error)) throw error;
            priverstinisPirmasIrankis = false;
            onEvent({ type: "tool_choice_fallback", priezastis: error.message });
            message = await requestCompletion({
                apiKey,
                fetchImpl,
                onEvent,
                beforeRequest,
                body: kurtiBody(step),
            });
        }
        messages.push(assistantMessage(message));

        const calls = message.tool_calls ?? [];
        if (!calls.length) {
            const text = typeof message.content === "string" ? message.content.trim() : "";
            if (!text) {
                /*
                Tuščias atsakymas su `finish_reason = "length"` reiškia, kad
                `max_tokens` biudžetą suėdė reasoning'as ir matomam atsakymui
                nieko neliko. Užklausa pilnai apmokėta, o rezultato nėra —
                todėl klaidos tekste iškart rodome, kurį nustatymą taisyti
                (`ai."modeliuVariantai".maxOutputTokens` arba `reasoningEffort`).

                Bandymus ši klaida DEGINA sąmoningai: jei biudžetas per mažas
                sistemiškai, kartojimas kas kelias minutes tik krautų sąskaitą.
                Penki bandymai su eksponentiniu atsitraukimu apriboja nuostolį,
                o `lastError` lieka matomas apžiūrai.
                */
                if (message.finishReason === "length") {
                    throw new Error(
                        `Modelis išnaudojo visą ${maxOutputTokens} tokenų biudžetą`
                        + " reasoning'ui ir negrąžino nei teksto, nei įrankio kvietimo."
                        + ' Kelkite ai."modeliuVariantai".maxOutputTokens arba mažinkite'
                        + " reasoningEffort.",
                    );
                }
                throw new Error("Modelis negrąžino nei teksto, nei įrankio kvietimo.");
            }

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
