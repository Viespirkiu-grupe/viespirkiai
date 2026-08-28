/*
Vienos OpenRouter užklausos apskaita — dydžiai ir kaina, be turinio.

Kaina auga ne nuo žingsnių skaičiaus, o nuo to, kad kiekvienas agento žingsnis
iš naujo siunčia visą ligtolinį pokalbį su jau perskaitytų dokumentų tekstais.
Iš `usage` bloko to nematyti, kol nepamatai, kaip pučiasi užklausos dydis, tad
`onEvent` iš harness'o čia paverčiamas po eilutę kiekvienam kreipiniui.

TURINYS NELOGINAMAS SĄMONINGAI: nei promptas, nei dokumentai, nei aprašymas.
Įrankių kvietimuose paliekami tik argumentai (dokumento ID, puslapiai) — be jų
neaišku, ką modelis skaitė; rezultatai matuojami ilgiu, ne spausdinami.
*/

/** Baitai → trumpas žmogui skaitomas dydis. */
export function dydis(baitai) {
    if (baitai < 1024) return `${baitai} B`;
    if (baitai < 1024 * 1024) return `${(baitai / 1024).toFixed(1)} KB`;
    return `${(baitai / (1024 * 1024)).toFixed(2)} MB`;
}

/** Kaina doleriais – su tiek ženklų, kad centų dalys nesusiplaktų į 0.00. */
export function kaina(usd) {
    if (!usd) return "$0";
    return usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(4)}`;
}

/**
 * Vieno žingsnio skaičiai iš `usage` bloko.
 *
 * OpenRouter `completion_tokens` JAU apima `reasoning_tokens`, tad matomam
 * atsakymui likusi dalis yra skirtumas — būtent ji parodo, kada reasoning'as
 * suėdė visą `max_tokens` biudžetą ir atsakymui nieko nebeliko.
 */
export function zingsnioSantrauka(usage) {
    const promptTokens = usage?.prompt_tokens ?? 0;
    const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const completion = usage?.completion_tokens ?? 0;
    const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    return {
        promptTokens,
        cached,
        cacheProc: promptTokens ? Math.round((cached / promptTokens) * 100) : 0,
        completion,
        reasoning,
        atsakymas: Math.max(completion - reasoning, 0),
        kaina: usage?.cost ?? 0,
    };
}

/**
 * Bendra kelių pirkimų sąskaita.
 *
 * Atskirta nuo zurnalo, nes masiniame paleidime pirkimai eina lygiagrečiai:
 * kiekvienas turi savo žurnalą, bet sąskaita viena.
 */
export function sukurtiSuvestine() {
    const viso = {
        uzklausu: 0,
        prompt: 0,
        cached: 0,
        completion: 0,
        reasoning: 0,
        kaina: 0,
    };
    return {
        viso,
        pridetiZingsni(s) {
            viso.uzklausu++;
            viso.prompt += s.promptTokens;
            viso.cached += s.cached;
            viso.completion += s.completion;
            viso.reasoning += s.reasoning;
            viso.kaina += s.kaina;
        },
        eilute() {
            const cacheProc = viso.prompt
                ? Math.round((viso.cached / viso.prompt) * 100)
                : 0;
            return `${viso.uzklausu} užklausų · prompt ${viso.prompt}`
                + ` (iš cache ${viso.cached}, ${cacheProc}%)`
                + ` · completion ${viso.completion} (reasoning ${viso.reasoning})`
                + ` · ${kaina(viso.kaina)}`;
        },
    };
}

/**
 * `onEvent` adapteris vienam aprašymui.
 *
 * @param {object} p
 * @param {string|number} p.zyme - kas aprašoma (rodoma kiekvienoje eilutėje,
 *   nes masiniame paleidime keli pirkimai rašo į tą patį srautą)
 * @param {(text: string) => void} [p.rasyk] - kur dėti eilutes
 * @param {boolean} [p.tylus] - neišvedinėti eilučių, tik kaupti suvestinę
 * @param {{ pridetiZingsni: (s: object) => void }} [p.suvestine]
 */
export function uzklausuZurnalas({ zyme, rasyk, tylus = false, suvestine }) {
    const rasyti = rasyk ?? ((text) => process.stderr.write(`${text}\n`));
    let zingsnis = 0;
    let finishReason = null;
    let pradeta = 0;
    const savi = { uzklausu: 0, kaina: 0, promptTokenu: 0, reasoningTokenu: 0 };

    const onEvent = (event) => {
        switch (event.type) {
            case "step_start":
                zingsnis = event.step;
                finishReason = null;
                pradeta = Date.now();
                break;

            case "request":
                savi.uzklausu++;
                if (!tylus) {
                    rasyti(
                        `#${zyme} →${zingsnis} ${event.model}`
                        + ` · ${event.zinutes} žin. · ${dydis(event.baitai)}`
                        + ` · max_tokens ${event.maxTokens}`
                        + ` · tool_choice ${event.toolChoice}`,
                    );
                }
                break;

            case "tool_choice_fallback":
                if (!tylus) {
                    rasyti(`#${zyme} ↺${zingsnis} tiekėjas atmetė tool_choice – kartojama su "auto"`);
                }
                break;

            case "retry":
                if (!tylus) {
                    rasyti(`#${zyme} !${zingsnis} kartojama po ${event.status} (${event.attempt}/2)`);
                }
                break;

            case "finish":
                finishReason = event.reason;
                break;

            case "usage": {
                const s = zingsnioSantrauka(event.usage);
                savi.kaina += s.kaina;
                savi.promptTokenu += s.promptTokens;
                savi.reasoningTokenu += s.reasoning;
                suvestine?.pridetiZingsni(s);
                if (!tylus) {
                    const truko = pradeta ? (Date.now() - pradeta) / 1000 : 0;
                    rasyti(
                        `#${zyme} ←${zingsnis} prompt ${s.promptTokens}`
                        + ` (cache ${s.cached}, ${s.cacheProc}%)`
                        + ` · atsakymas ${s.atsakymas} + reasoning ${s.reasoning}`
                        + ` · ${finishReason ?? "?"} · ${truko.toFixed(1)} s · ${kaina(s.kaina)}`,
                    );
                }
                break;
            }

            case "tool_start":
                if (!tylus) {
                    rasyti(`#${zyme}  ⚒${zingsnis} ${event.name} ${JSON.stringify(event.args)}`);
                }
                break;

            case "tool_result":
                // Matuojamas tik grąžinto teksto ilgis — turinys neloginamas.
                if (!tylus) {
                    rasyti(
                        `#${zyme}  ${event.isError ? "✗" : "✓"}${zingsnis} ${event.name}`
                        + ` · grąžinta ${dydis(event.text.length)}`,
                    );
                }
                break;
        }
    };

    return { onEvent, savi };
}
