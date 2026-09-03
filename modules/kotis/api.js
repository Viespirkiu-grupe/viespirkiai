import { createScraperFetch } from "../../utils/scrapeFetch.js";
import config from "../../utils/config.js";
import { log } from "../../utils/log.js";

const defaultFetch = createScraperFetch("kotis", { operation: "scrape" });
const sessionCookies = new Map();

function baseUrl() {
    return config.kotisUrl.replace(/\/+$/, "");
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(response, attempt) {
    const retryAfter = Number(response?.headers?.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1_000;
    return Math.min(30_000, 500 * 2 ** (attempt - 1));
}

function isRetryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function transportError(error) {
    const code = error?.code ?? error?.cause?.code;
    return `${error.message}${code ? ` (${code})` : ""}`;
}

function captureCookies(headers) {
    const values = headers.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie")] : []);
    for (const value of values) {
        const pair = value.split(";", 1)[0];
        const separator = pair.indexOf("=");
        if (separator > 0) sessionCookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
}

function cookieHeader() {
    return [...sessionCookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function sameHostUrl(location, requestUrl) {
    const base = new URL(`${baseUrl()}/`);
    const target = new URL(location, requestUrl);
    target.protocol = base.protocol;
    target.host = base.host;
    // Mirror gali gyventi po kelio prefiksu (pvz. http://proxy/kotis) — KOTIS
    // nukreipimai visada absoliutūs nuo šaknies, todėl prefiksą grąžiname.
    const prefix = base.pathname.replace(/\/+$/, "");
    if (prefix && !target.pathname.startsWith(`${prefix}/`) && target.pathname !== prefix) {
        target.pathname = `${prefix}${target.pathname}`;
    }
    return target;
}

/**
 * KOTIS nukreipimus išduoda absoliučiu viešuoju adresu (kotis.kt.gov.lt), kuris
 * iš mirror'o nepasiekiamas, todėl sekame patys, hostą pakeisdami į sukonfigūruotą.
 */
async function fetchFollowing(fetchImpl, url, init = {}, maxRedirects = 5) {
    let current = new URL(url);
    for (let hop = 0; ; hop++) {
        const response = await fetchImpl(current.href, { ...init, redirect: "manual" });
        captureCookies(response.headers);
        const location = response.status >= 300 && response.status < 400
            ? response.headers.get("location")
            : null;
        if (!location) return { response, url: current };
        if (hop >= maxRedirects) throw new Error(`KOTIS per daug nukreipimų iš ${url}`);
        await response.text().catch(() => "");
        current = sameHostUrl(location, current);
        const headers = init.headers ? { ...init.headers } : {};
        if (sessionCookies.size) headers.Cookie = cookieHeader();
        init = { ...init, method: "GET", body: undefined, headers };
    }
}

function inputValue(html, name) {
    const input = [...html.matchAll(/<input\b[^>]*>/gi)]
        .map((match) => match[0])
        .find((tag) => new RegExp(`\\bname\\s*=\\s*["']${name}["']`, "i").test(tag));
    return input?.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] ?? null;
}

function responseSummary(response, html) {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
    return [
        `URL ${response.url || "nežinomas"}`,
        `HTML ${html.length} B`,
        title ? `title „${title}“` : null,
    ].filter(Boolean).join(", ");
}

export async function prepareKotisSession({ fetchImpl = defaultFetch, pageSize = 1_000 } = {}) {
    sessionCookies.clear();
    const sessionUrl = new URL(`${baseUrl()}/paraiskos`);
    sessionUrl.searchParams.set("include_archive", "1");
    sessionUrl.searchParams.set("ordering", "id.asc");
    sessionUrl.searchParams.set("ff", "1");
    sessionUrl.searchParams.set("page", "1");
    const { response: page } = await fetchFollowing(fetchImpl, sessionUrl);
    if (!page.ok) throw new Error(`KOTIS sesijos pradžia: HTTP ${page.status}`);
    const html = await page.text();
    const form = html.match(/<form\b[^>]*\bpager_value\b[^>]*>[\s\S]*?<\/form>/i)?.[0];
    const token = inputValue(form ?? "", "_token") ?? inputValue(html, "_token");
    if (!form || !token) {
        throw new Error(
            `KOTIS puslapyje nerasta įrašų skaičiaus forma arba CSRF žyma (${responseSummary(page, html)})`,
        );
    }

    const response = await fetchImpl(`${baseUrl()}/general/setwrap`, {
        method: "POST",
        redirect: "manual",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookieHeader(),
        },
        body: new URLSearchParams({
            _token: token,
            token,
            module: "applications",
            action: "listing_items",
            wrap: String(pageSize),
        }),
    });
    captureCookies(response.headers);
    if (response.status < 200 || response.status >= 400) {
        throw new Error(`KOTIS puslapio dydžio nustatymas: HTTP ${response.status}`);
    }
    await response.text();
}

export async function fetchKotisHtml(url, {
    fetchImpl = defaultFetch,
    maxAttempts = 5,
    timeoutMs = 45_000,
    wait = sleep,
} = {}) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const { response, url: finalUrl } = await fetchFollowing(fetchImpl, url, {
                signal: AbortSignal.timeout(timeoutMs),
                headers: {
                    Accept: "text/html,application/xhtml+xml",
                    "User-Agent": "viespirkiai.org KOTIS importer/2",
                    ...(sessionCookies.size ? { Cookie: cookieHeader() } : {}),
                },
            });
            if (response.ok) {
                // Nežinomo įrašo KOTIS neduoda 404 — nukreipia į sąrašą, todėl
                // pasikeitęs kelias reiškia, kad prašyto puslapio nėra.
                if (finalUrl.pathname !== new URL(url).pathname) {
                    throw new Error(`KOTIS ${url} nukreipė į ${finalUrl.href} — įrašo nėra`);
                }
                return await response.text();
            }
            const body = await response.text().catch(() => "");
            if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
                throw new Error(`KOTIS HTTP ${response.status}: ${body.slice(0, 200)}`);
            }
            const delay = retryDelay(response, attempt);
            log(`KOTIS HTTP ${response.status}, kartojama po ${Math.round(delay / 1_000)} s (${attempt}/${maxAttempts})`);
            await wait(delay);
        } catch (error) {
            lastError = error;
            const retryable = error?.name === "AbortError"
                || error?.name === "TimeoutError"
                || error instanceof TypeError;
            if (!retryable || attempt === maxAttempts) throw error;
            const delay = retryDelay(null, attempt);
            log(
                `KOTIS užklausa ${url} nepavyko, kartojama po ${Math.round(delay / 1_000)} s `
                + `(${attempt}/${maxAttempts}): ${transportError(error)}`,
            );
            await wait(delay);
        }
    }
    throw lastError;
}

export function kotisListUrl(from, page = 1, to = from, filters = {}) {
    const url = new URL(`${baseUrl()}/paraiskos`);
    url.searchParams.set("aid_date[from]", from);
    url.searchParams.set("aid_date[to]", to);
    url.searchParams.set("include_archive", "1");
    // Datos filtras visas eilutes sulygina, todėl vien datos rikiavimas nėra
    // stabilus offset puslapiavimui. KOTIS vidinis ID yra unikalus cursoris.
    url.searchParams.set("ordering", filters.ordering ?? "id.asc");
    url.searchParams.set("ff", "1");
    url.searchParams.set("page", String(page));
    if (filters.amountFrom != null) url.searchParams.set("aid_amount[from]", filters.amountFrom);
    if (filters.amountTo != null) url.searchParams.set("aid_amount[to]", filters.amountTo);
    return url.href;
}

export function kotisDetailUrl(id) {
    if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) {
        throw new Error(`Netinkamas KOTIS ID: ${id}`);
    }
    return `${baseUrl()}/paraiskos/view_item/id.${id}`;
}
