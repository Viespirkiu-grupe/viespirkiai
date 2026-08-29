import net from "node:net";

/*
Adreso skaidymas ir surinkimas. Atitinka documents.documents laukus
"protocolId" + "hostId" + path bei documents."documentsFull" surinkimo taisyklę.

Sąmoningai nenaudojam `new URL()`: jis normalizuoja ir perkoduoja kelią
(procentinis kodavimas, tuščias path virsta „/"), tad round-trip nebūtų tikslus.
Skaidymas eina lygiai taip pat, kaip migracijos SQL – tekstu.
*/

const MAX_PORT = 65535;

/** Registruojamas domenas: paskutiniai du hosto vardo lygiai. */
export function registrableDomain(host) {
    const value = String(host ?? "").replace(/^\[|\]$/g, "").toLowerCase();
    if (!value || value === "localhost" || net.isIP(value)) return value;
    const parts = value.split(".").filter(Boolean);
    return parts.length > 1 ? parts.slice(-2).join(".") : value;
}

/** Atskiria hostą nuo porto. IPv6 laužtiniai skliaustai lieka hoste. */
function splitAuthority(authority) {
    const closing = authority.lastIndexOf("]");
    const colon = authority.indexOf(":", closing + 1);
    if (colon === -1) return { host: authority, port: null };
    const port = Number(authority.slice(colon + 1));
    if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
        return { host: authority, port: null };
    }
    return { host: authority.slice(0, colon), port };
}

/**
 * @param {string} url
 * @returns {{ protocol: string, host: string, port: number|null, path: string }}
 */
export function splitUrl(url) {
    const raw = String(url ?? "");
    const schemeEnd = raw.indexOf("://");
    if (schemeEnd === -1) throw new Error(`splitUrl: netinkamas URL „${raw}"`);

    const protocol = raw.slice(0, schemeEnd);
    const rest = raw.slice(schemeEnd + 3);
    const slash = rest.indexOf("/");
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    const path = slash === -1 ? "/" : rest.slice(slash);

    if (!protocol || !authority) throw new Error(`splitUrl: netinkamas URL „${raw}"`);

    return { protocol, ...splitAuthority(authority), path };
}

/**
 * @param {{ protocol: string, host: string, port?: number|null, path: string }} parts
 * @returns {string}
 */
export function buildUrl({ protocol, host, port = null, path }) {
    return `${protocol}://${host}${port ? `:${port}` : ""}${path}`;
}
