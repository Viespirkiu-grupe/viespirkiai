// Structured reading of the ATN-1/PPA report's `atmetimoTeisinisPagrindas`
// field, shared by LT-COM-21's definition (which states the grounds it
// matches) and its decision (which reads the grounds off a bid).
//
// The field is nominally a dropdown, but the warehouse's own dictionary
// (`ppa."atmetimoTeisiniaiPagrindai"`, 23 rows) proves buyers can type into
// it: alongside the expected `"VPĮ 45 str. 1 d. 1 p."` it holds `"ę"`,
// `"Lietuva"`, the spreadsheet's own column header, a whole prose paragraph
// that cites the article mid-sentence, the law's name spelled out in full,
// and citations missing their trailing full stop. Comparing the raw display
// string against a list of expected spellings therefore misses genuine
// citations for punctuation reasons alone — so both sides are parsed into
// this structured form and compared as citations instead.

export type LegalBasisCitation = Readonly<{
    /** Normalised law abbreviation — see LAW_PATTERNS. */
    law: string;
    straipsnis: number;
    dalis: number;
    punktas: number;
}>;

// The two procurement laws whose rejection grounds this field cites. `PĮ`
// is the abbreviation the Viešųjų pirkimų tarnyba's own guidance uses for
// the utilities-sector law (e.g. "VPĮ 45 straipsnio 3 dalies (PĮ 58
// straipsnio 5 dalies) nuostatomis"), and the warehouse dictionary carries
// both `KSPĮ 58 str. …` and `PĮ 58 str. …` rows for it, so both normalise
// to the same law. The lookbehind keeps `PĮ` from matching inside `VPĮ` or
// `KSPĮ`.
const LAW_PATTERNS: readonly (readonly [RegExp, string])[] = [
    [/(?<!\p{L})(?:KSPĮ|PĮ)(?!\p{L})/u, "KSPĮ"],
    [/(?<!\p{L})(?:VPĮ|Viešųjų\s+pirkimų\s+įstatym\p{L}*)(?!\p{L})/u, "VPĮ"],
];

// `45 str. 1 d. 1 p.` and its longhand `45 straipsnio 1 dalies 1 punkto`,
// with every trailing full stop optional — the dictionary holds both
// `"VPĮ 45 str. 1 d. 5 p."` and `"VPĮ 45 str. 1 d. 5 p"`.
const CITATION_PATTERN =
    /(\d{1,3})\s*(?:str\.?|straipsni\p{L}*)\s*(\d{1,2})\s*(?:d\.?|dali\p{L}*)\s*(\d{1,2})\s*(?:p\.?|punkt\p{L}*)/gu;

/**
 * Every `<law> <N> str. <N> d. <N> p.` citation in a free-text legal-basis
 * value, in the order they appear. The law is taken from the nearest law
 * token at or before the citation, so a prose value that cites the statute
 * and then a clause of the buyer's own tender conditions ("… Viešųjų
 * pirkimų įstatymo 45 str. 1 d. 1 p. ir Bendrųjų Pirkimo sąlygų 18.1.7.
 * p. …") yields the statute citation and not the tender-conditions one,
 * which carries no `str.`/`d.` and so never matches CITATION_PATTERN at
 * all. A value with no recognised law, or none with a citation after it,
 * yields nothing — `"Kita"`, `"Pasiūlymas neatitinka pirkimo dokumentuose
 * nustatytų reikalavimų"` and the empty string are all correctly read as
 * "no legal basis cited", which is LT-AWD-03's concept, not this one.
 */
export function parseLegalBasisCitations(value: string | null): readonly LegalBasisCitation[] {
    if (value === null) return [];

    const lawTokens: { index: number; law: string }[] = [];
    for (const [pattern, law] of LAW_PATTERNS) {
        for (const match of value.matchAll(new RegExp(pattern.source, pattern.flags + "g"))) {
            lawTokens.push({ index: match.index, law });
        }
    }
    if (lawTokens.length === 0) return [];
    lawTokens.sort((a, b) => a.index - b.index);

    const citations: LegalBasisCitation[] = [];
    for (const match of value.matchAll(CITATION_PATTERN)) {
        let law: string | null = null;
        for (const token of lawTokens) {
            if (token.index > match.index) break;
            law = token.law;
        }
        if (law === null) continue;
        citations.push({
            law,
            straipsnis: Number(match[1]),
            dalis: Number(match[2]),
            punktas: Number(match[3]),
        });
    }
    return citations;
}

/**
 * The single citation a parameter entry spells — parsed through exactly the
 * same reader as the warehouse value, so the parameter list stays written
 * in the legal vocabulary a reviewer recognises rather than as tuples.
 * Throws on an unparseable entry: a parameter that silently matched nothing
 * would be indistinguishable from a ground that never occurs in the data.
 */
export function parseLegalBasisParameter(value: string): LegalBasisCitation {
    const citations = parseLegalBasisCitations(value);
    if (citations.length !== 1) {
        throw new Error(`LT-COM-21: legal-basis parameter is not a single citation: ${JSON.stringify(value)}`);
    }
    return citations[0];
}

export function citationsEqual(a: LegalBasisCitation, b: LegalBasisCitation): boolean {
    return a.law === b.law && a.straipsnis === b.straipsnis && a.dalis === b.dalis && a.punktas === b.punktas;
}
