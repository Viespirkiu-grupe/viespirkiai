import { parseHTML } from "linkedom";

const DETAIL_PATH = /\/paraiskos\/view_item\/id\.(\d+)/;

function clean(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text || null;
}

function text(node) {
    return clean(node?.textContent);
}

function normalizeLabel(value) {
    return String(value ?? "")
        .toLocaleLowerCase("lt")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ė/g, "e")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

export function parseAmount(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error(`Netinkama suma: ${value}`);
        return value;
    }
    const raw = String(value).replace(/[^\d,.-]/g, "");
    const comma = raw.lastIndexOf(",");
    const dot = raw.lastIndexOf(".");
    const decimalIndex = Math.max(comma, dot);
    const decimalDigits = decimalIndex >= 0 ? raw.length - decimalIndex - 1 : 0;
    const separator = decimalIndex >= 0 ? raw[decimalIndex] : null;
    const separatorCount = separator ? raw.split(separator).length - 1 : 0;
    const mixedSeparators = comma >= 0 && dot >= 0;
    const groupingOnly = separatorCount > 1
        || (!mixedSeparators && separator === "." && decimalDigits === 3);
    const hasDecimal = !groupingOnly && decimalIndex >= 0 && decimalDigits > 0 && decimalDigits <= 4;
    const integerPart = hasDecimal ? raw.slice(0, decimalIndex) : raw;
    const fraction = hasDecimal ? raw.slice(decimalIndex + 1) : "";
    const normalized = `${integerPart.replace(/[^\d-]/g, "")}${hasDecimal ? `.${fraction}` : ""}`;
    if (!normalized) return null;
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) throw new Error(`Netinkama suma: ${value}`);
    return amount;
}

export function parseDate(value) {
    const normalized = clean(value);
    if (!normalized) return null;
    let match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    match = normalized.match(/^(\d{2})[.-](\d{2})[.-](\d{4})$/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    throw new Error(`Netinkama data: ${value}`);
}

export function parseBoolean(value) {
    const normalized = normalizeLabel(value);
    if (["taip", "yes"].includes(normalized)) return true;
    if (["ne", "no"].includes(normalized)) return false;
    return null;
}

function idFromHref(href) {
    const match = String(href ?? "").match(DETAIL_PATH);
    return match ? Number(match[1]) : null;
}

function absoluteUrl(href, baseUrl) {
    if (!href) return null;
    const base = new URL(baseUrl);
    const target = new URL(href, base);
    target.protocol = base.protocol;
    target.username = base.username;
    target.password = base.password;
    target.host = base.host;
    return target.href;
}

function totalFromDocument(document) {
    for (const heading of document.querySelectorAll("h5.text-icon")) {
        const match = text(heading)?.match(/Viso pagalb[uų]:\s*([\d\s.]+)/i);
        if (match) return Number(match[1].replace(/[^\d]/g, ""));
    }
    return null;
}

export function parseListPage(html, pageUrl) {
    const { document } = parseHTML(html);
    const table = document.querySelector("table.table-bordered.table-hover");
    const rows = [];

    for (const row of table?.querySelectorAll("tbody > tr") ?? []) {
        const cells = [...row.querySelectorAll("td")];
        const link = row.querySelector('a[title="Peržiūrėti paraišką"]')
            ?? [...row.querySelectorAll("a")].find((anchor) => idFromHref(anchor.getAttribute("href")));
        const id = idFromHref(link?.getAttribute("href"));
        if (!id) throw new Error(`KOTIS sąrašo eilutėje nerastas kortelės ID: ${text(row)}`);
        if (cells.length < 7) throw new Error(`KOTIS sąrašo eilutėje tik ${cells.length} stulpeliai`);
        rows.push({
            id,
            url: absoluteUrl(link.getAttribute("href"), pageUrl),
            gavejas: text(cells[0]),
            teikejas: text(cells[1]),
            suteikimoData: parseDate(text(cells[2]?.querySelector("a")) ?? text(cells[2])),
            suma: parseAmount(text(cells[3])),
            teisinisPagrindas: text(cells[4]),
            pagalbosRusis: text(cells[5]),
            busena: text(cells[6]),
        });
    }

    const next = document.querySelector("ul.pagination a.page_next.page-link");
    const emptyMessages = new Set([
        "pagalbu nerasta", "pagalbu nera", "irasu nerasta", "duomenu nerasta", "no results",
    ]);
    const hasNoResults = [...document.querySelectorAll(".alert.alert-info.my-3")]
        .some((node) => emptyMessages.has(normalizeLabel(text(node))));
    if (!table && !hasNoResults) throw new Error("KOTIS atsakyme nerasta rezultatų lentelė");

    return {
        rows,
        total: totalFromDocument(document) ?? (hasNoResults ? 0 : null),
        nextUrl: absoluteUrl(next?.getAttribute("href"), pageUrl),
        pageSize: Number(document.querySelector('form.pager_value input[name="wrap"]')?.getAttribute("value")) || null,
    };
}

function detailFields(document) {
    const fields = new Map();
    const fieldValues = new Map();
    const labels = new Map();
    for (const row of document.querySelectorAll("main tr")) {
        const cells = [...row.querySelectorAll(":scope > td")];
        if (cells.length < 2) continue;
        const values = [...cells[1].querySelectorAll("li")].map(text).filter(Boolean);
        if (!values.length) values.push(text(cells[1]));
        const code = cells[0].getAttribute("data-code");
        if (code) {
            const present = fieldValues.get(code) ?? [];
            fieldValues.set(code, [...present, ...values.filter(Boolean)]);
            if (!fields.has(code)) fields.set(code, values[0] ?? null);
        }
        const label = normalizeLabel(text(cells[0]));
        if (label) labels.set(label, values.join("; ") || null);
    }
    for (const heading of document.querySelectorAll("main .link-group h5, main h5")) {
        const value = text(heading);
        const separator = value?.indexOf(":") ?? -1;
        if (separator > 0) {
            labels.set(normalizeLabel(value.slice(0, separator)), clean(value.slice(separator + 1)));
        }
    }
    return { fields, fieldValues, labels };
}

function labelValue(labels, ...needles) {
    for (const [label, value] of labels) {
        if (needles.some((needle) => label === needle || label.startsWith(needle))) return value;
    }
    return null;
}

function splitSubject(value) {
    const normalized = clean(value);
    if (!normalized) return null;
    const dash = normalized.match(/^(.*?)\s+-\s+([^\s]+)$/);
    const parentheses = normalized.match(/^(.*?)\s*\(([^()]+)\)$/);
    const match = dash ?? parentheses;
    return {
        pavadinimas: clean(match?.[1] ?? normalized),
        kodas: clean(match?.[2]),
    };
}

function relatedSubjects(document) {
    const heading = [...document.querySelectorAll("main h5")]
        .find((node) => normalizeLabel(text(node)).startsWith("susije asmenys subjektai"));
    const list = heading?.nextElementSibling?.matches("ul.list-group")
        ? heading.nextElementSibling
        : heading?.parentElement?.querySelector("ul.list-group");
    if (!list) return [];
    return [...list.querySelectorAll(":scope > li")].map((item, index) => {
        const spans = [...item.querySelectorAll(":scope > span")];
        const rawSubject = text(spans[0] ?? item)?.replace(/^\d+\.\s*/, "");
        return {
            ...splitSubject(rawSubject),
            rysioTipas: text(spans[1]),
            eilesNumeris: index + 1,
        };
    }).filter((item) => item.pavadinimas);
}

function legalAct(value, tipas) {
    const pavadinimas = clean(value);
    return pavadinimas ? { pavadinimas, tipas } : null;
}

export function parseDetailPage(html, url, listRow = {}) {
    const { document } = parseHTML(html);
    const { fields, fieldValues, labels } = detailFields(document);
    if (!document.querySelector("main")) throw new Error("KOTIS kortelėje nerastas main elementas");

    const expectedId = idFromHref(url);
    const parsedId = Number(String(labelValue(labels, "id") ?? "").replace(/\D/g, "")) || expectedId;
    if (!parsedId || (expectedId && parsedId !== expectedId)) {
        throw new Error(`KOTIS kortelės ID neatitinka URL: ${parsedId ?? "nėra"} / ${expectedId}`);
    }

    const heading = text(document.querySelector("main h1"));
    const gavejoKodas = labelValue(labels, "pagalbos gavejo kodas") ?? splitSubject(heading)?.kodas;
    const gavejas = splitSubject(heading ?? listRow.gavejas);
    const teisesAktai = [
        ...(fieldValues.get("legal_basis") ?? []).map((value) => legalAct(value, "legalBasis")),
        ...(fieldValues.get("legal_basis_1") ?? []).map((value) => legalAct(value, "normative")),
        ...(fieldValues.get("legal_basis_2") ?? []).map((value) => legalAct(value, "individual")),
    ].filter(Boolean);
    const registrationLocation = labelValue(labels, "pagalbos gavejo registracijos vieta");
    const gavejasUzsienietis = registrationLocation == null
        ? null
        : /uzsien|foreign/.test(normalizeLabel(registrationLocation));

    return {
        id: parsedId,
        url,
        gavejas: gavejas && { ...gavejas, kodas: gavejoKodas ?? gavejas.kodas },
        teikejas: splitSubject(fields.get("aid_provider") ?? listRow.teikejas),
        duomenuPildytojas: splitSubject(labelValue(labels, "duomenu pildytojas")),
        gavejoTipas: labelValue(labels, "pagalbos gavejo tipas"),
        gavejasUzsienietis,
        suteikimoData: parseDate(fields.get("aid_date") ?? listRow.suteikimoData),
        pagalbosPateikimoData: parseDate(labelValue(labels, "pagalbos pateikimo data")),
        busenosSuteikimoData: parseDate(labelValue(labels, "busenos suteikimo data")),
        suma: parseAmount(fields.get("aid_amount") ?? listRow.suma),
        pagalbosTipas: fields.get("aid_type"),
        pagalbosRusis: fields.get("aid_kind") ?? listRow.pagalbosRusis,
        pagalbosForma: fields.get("aid_form"),
        busena: labelValue(labels, "busena") ?? listRow.busena,
        priemonesTipas: fields.get("aid_scheme"),
        produktoSektorius: fields.get("product_sector"),
        gavejoVeiklosRusis: fields.get("receiver_activity_kind"),
        pagrindinisTikslas: fields.get("objective"),
        antrinisTikslas: fields.get("secondary_objective"),
        registracijosKodas: labelValue(labels, "registracijos kodas"),
        europosKomisijosNumeris: fields.get("valst_schema_nr"),
        versija: Number(labelValue(labels, "versija")) || null,
        tinkamosDengtiIslaidos: fields.get("aid_expenses"),
        pastaba: fields.get("comment"),
        taisykles: [...new Set(fieldValues.get("special_rules") ?? [])],
        teisesAktai,
        valstybesPagalbosDetales: {
            schemosPavadinimas: fields.get("valst_schema"),
            intensyvumasProc: parseAmount(fields.get("aid_intensity")),
            taikomosLaikinosTaisykles: parseBoolean(fields.get("has_special_rules")),
        },
        finansinesDetales: {
            patiriaFinansiniuSunkumu: parseBoolean(fields.get("financial_difficulties")),
            paskolosSuma: parseAmount(fields.get("loan_amount")),
            garantuojamaPaskolosDaliesSuma: parseAmount(fields.get("approved_expenses")),
        },
        deMinimisDetales: {
            yraSusijusiuSubjektu: parseBoolean(fields.get("has_related_subjects")),
            vertinimoPagrindas: fields.get("evaluated_data"),
            velavimoRegistruotiPriezastis: fields.get("registration_delay_reason"),
        },
        susijeSubjektai: relatedSubjects(document),
    };
}
