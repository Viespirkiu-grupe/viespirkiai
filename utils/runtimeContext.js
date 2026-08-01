import { AsyncLocalStorage } from "node:async_hooks";
import config from "./config.js";

/**
 * Kas ir kur vykdo kodą – naudojama SQL logo įrašams paženklinti, kad
 * Quickwit'e būtų galima atskirti dev/prod ir web/taskRunner srautus.
 */

/** `dev` | `prod` – pagal NODE_ENV (žr. utils/configSchema.js `dev`). */
export const APP_ENV = config.dev ? "dev" : "prod";

/**
 * Proceso vaidmuo. Pirmenybė – aiškiam `APP_ROLE` kintamajam; kitaip
 * spėjama pagal paleistą failą:
 *   server     – start-server.mjs / dist/server (Astro SSR), astro dev
 *   taskRunner – tasks/index.js (žr. startTaskRunner.sh)
 *   worker     – runner/Worker.js atskirame procese
 *   cli        – visa kita (skriptai, migracijos, vienkartinės komandos)
 */
function nustatytiVaidmeni() {
    const nurodytas = process.env.APP_ROLE?.trim();
    if (nurodytas) return nurodytas;

    const entry = (process.argv[1] ?? "").replaceAll("\\", "/");
    if (/\/tasks\/index\.js$/.test(entry)) return "taskRunner";
    if (/\/runner\/Worker\.js$/.test(entry)) return "worker";
    if (
        /start-server\.mjs$/.test(entry) ||
        /\/dist\/server\//.test(entry) ||
        /\/astro(\.js)?$/.test(entry)
    ) {
        return "server";
    }
    return "cli";
}

export const APP_ROLE = nustatytiVaidmeni();

/** @typedef {{ host?: string | null }} RequestContext */

const storage = new AsyncLocalStorage();

/**
 * Paleidžia `fn` su užklausos kontekstu (hostas). Viskas, kas vyksta viduje –
 * įskaitant DB užklausas – tą kontekstą mato.
 *
 * @template T
 * @param {RequestContext} context
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithRequestContext(context, fn) {
    return storage.run(context, fn);
}

/** Dabartinės užklausos kontekstas arba `undefined` (fone, taskRunner'yje…). */
export function getRequestContext() {
    return storage.getStore();
}

/**
 * Hostas iš užklausos antraščių. Už proxy (Cloudflare, nginx) tikrasis vardas
 * lieka `x-forwarded-host`, o `host` tada rodo vidinį adresą.
 *
 * @param {Headers} headers
 * @param {URL} [url] - atsarginis šaltinis, kai antraščių nėra.
 */
export function hostFromHeaders(headers, url) {
    const forwarded = headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    return forwarded || headers.get("host")?.trim() || url?.host || null;
}
