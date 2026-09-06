/*
Standalone reverse proxy, kurį scraperiai mato kaip `scrapeProxies` eilutę su
`type = httpReverse`: užklausa atkeliauja į šį serverį HTTP'u, o toliau į šaltinį
eina per SOCKS5 tunelį.

    node modules/proxy/server.js <portas> <socks5://user:pass@ip:port>
    node modules/proxy/server.js 9203 socks5://vartotojas:slaptas@10.1.10.7:1080

Kelio prefiksas nusako šaltinį:

    /vpmis/index.php?x=1  →  https://eviesiejipirkimai.lt/index.php?x=1

Nuo repozitorijos nepriklauso — jokio config'o, DB ar bendrų modulių, tik
`socks-proxy-agent`. Tad jį galima kelti atskirai, ten, kur yra SOCKS išėjimas.

Kelias ir query nekeičiami, kad scrapeLog'e (`utils/scrapeTarget.js`) origin'ą
būtų galima perrašyti atgal į viešąjį adresą vienas su vienu. `Location`
antraštė pergrąžinama į šį serverį, kad redirect'us sekantis scraperis
neišsprūstų iš tunelio.

Savo klaidas proxy pažymi `X-Proxy-Error` antrašte (`no-route`, SOCKS/jungties
kodas). Be jos scraperis 502 kūną parsintų kaip šaltinio puslapį ir praneštų,
kad nerado sutarčių lentelės.
*/

import http from "node:http";
import https from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";
import { forwardHeaders, outgoingHeaders, sanitizeHeaderValue } from "./headers.js";

/** Kelio prefiksas → šaltinio originas. */
const ROUTES = {
    "/vpmis": "https://eviesiejipirkimai.lt",
};

const REQUEST_TIMEOUT_MS = 9 * 60_000;

function usage(message) {
    console.error(`${message}\n`);
    console.error("Naudojimas: node modules/proxy/server.js <portas> <socks5://[user:pass@]ip[:port]>");
    console.error("Keliai:");
    for (const [prefix, origin] of Object.entries(ROUTES)) {
        console.error(`  ${prefix}/…  →  ${origin}/…`);
    }
    process.exit(1);
}

const port = Number(process.argv[2]);
const socksUrl = process.argv[3];

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    usage(`Netinkamas portas: ${process.argv[2] ?? "(nenurodytas)"}`);
}
if (!socksUrl || !/^socks(5|5h|4|4a)?:\/\//i.test(socksUrl)) {
    usage(`Netinkamas SOCKS adresas: ${socksUrl ?? "(nenurodytas)"}`);
}

let agent;
try {
    agent = new SocksProxyAgent(socksUrl, { keepAlive: true });
} catch (error) {
    usage(`Nepavyko sukurti SOCKS agento: ${error.message}`);
}

/** Prefiksą atitinkantis maršrutas arba `null`. */
function route(pathname) {
    for (const [prefix, origin] of Object.entries(ROUTES)) {
        if (pathname === prefix) return { origin, rest: "/", prefix };
        if (pathname.startsWith(`${prefix}/`)) {
            return { origin, rest: pathname.slice(prefix.length), prefix };
        }
    }
    return null;
}

/**
 * `Location` grąžinama į šį serverį — kitaip scraperis redirect'ą sektų
 * tiesiai į šaltinį ir SOCKS tunelis liktų nepanaudotas.
 */
function rewriteLocation(location, target, prefix) {
    try {
        const resolved = new URL(location, target);
        if (resolved.origin !== target.origin) return location;
        return `${prefix}${resolved.pathname}${resolved.search}`;
    } catch {
        return location;
    }
}

/** Atsarginis `content-type`, kai visos antraštės atmestos. */
function sanitizeContentType(value) {
    const text = String(value ?? "").replace(/[^\t\x20-\x7e]/g, "").trim();
    return text === "" ? "application/octet-stream" : text;
}

const server = http.createServer((req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://proxy.local");

    if (url.pathname === "/healthz") {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("ok\n");
        return;
    }

    const matched = route(url.pathname);
    if (!matched) {
        res.writeHead(404, {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Proxy-Error": "no-route",
        });
        res.end(`Nežinomas kelias: ${url.pathname}\n`);
        console.warn(`${req.method} ${url.pathname} → 404 (nėra maršruto)`);
        return;
    }

    const target = new URL(matched.rest + url.search, matched.origin);
    const client = target.protocol === "http:" ? http : https;

    const upstream = client.request(
        target,
        {
            method: req.method,
            headers: outgoingHeaders(req.headers, target),
            agent,
        },
        (upstreamRes) => {
            const headers = forwardHeaders(upstreamRes.headers, {
                rewrite: (name, value) => name === "location"
                    ? rewriteLocation(value, target, matched.prefix)
                    : value,
                onWarn: (message) => console.warn(`${target.href}: ${message}`),
            });
            const status = upstreamRes.statusCode ?? 502;
            try {
                res.writeHead(status, headers);
            } catch (error) {
                // Paskutinis barjeras: net išvalius, antraštė gali nepatikti
                // (pvz. per ilga) — atsakymą atiduodam be jos, bet nekrentam.
                console.error(`${target.href}: antraščių klaida (${error.message}), atiduodam be jų`);
                res.writeHead(status, {
                    "content-type": sanitizeContentType(upstreamRes.headers["content-type"]),
                });
            }
            let bytes = 0;
            upstreamRes.on("data", (chunk) => { bytes += chunk.length; });
            upstreamRes.on("end", () => {
                console.log(
                    `${req.method} ${target.href} → ${upstreamRes.statusCode}`
                    + ` ${bytes} B ${Date.now() - started} ms`,
                );
            });
            upstreamRes.pipe(res);
        },
    );

    upstream.setTimeout(REQUEST_TIMEOUT_MS, () => {
        upstream.destroy(new Error(`timeout po ${REQUEST_TIMEOUT_MS} ms`));
    });

    upstream.on("error", (error) => {
        console.error(`${req.method} ${target.href} → klaida: ${error.message}`);
        if (!res.headersSent) {
            // `X-Proxy-Error` leidžia scraperiui atskirti proxy nesėkmę nuo
            // šaltinio atsakymo: kitaip 502 kūnas parsinamas kaip puslapis ir
            // atrodo, lyg šaltinyje nebūtų lentelės.
            res.writeHead(502, {
                "Content-Type": "text/plain; charset=utf-8",
                "X-Proxy-Error": sanitizeHeaderValue(error.code ?? error.message) ?? "upstream",
            });
        }
        res.end(`Proxy klaida: ${error.message}\n`);
    });

    // Klientas gali nutrūkti (scraperio abort) — tada užklausos šaltiniui
    // tęsti nebereikia.
    req.on("aborted", () => upstream.destroy());
    req.on("error", (error) => {
        console.error(`Kliento srauto klaida: ${error.message}`);
        upstream.destroy();
    });
    res.on("error", (error) => console.error(`Atsakymo srauto klaida: ${error.message}`));
    req.pipe(upstream);
});

let listening = false;

// Serverio lygio klaida (užimtas portas, teisių nebuvimas) — stojam garsiai.
server.on("error", (error) => {
    console.error(`Serverio klaida: ${error.message}`);
    process.exit(1);
});

server.on("clientError", (error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    console.error(`Kliento klaida: ${error.message}`);
});

server.listen(port, () => {
    listening = true;
    console.log(`Reverse proxy klauso :${port}, išeina per ${socksUrl.replace(/\/\/[^@]*@/, "//***@")}`);
    for (const [prefix, origin] of Object.entries(ROUTES)) {
        console.log(`  ${prefix}/…  →  ${origin}/…`);
    }
});

// Paskutinė apsauga: viena netvarkinga užklausa neturi nužudyti proxy, per kurį
// dirba visi scraperiai. Bet kol serveris dar nepakilo (pvz. portas užimtas),
// klaida yra fatališka — tyliai gyvas, bet neaptarnaujantis procesas blogiau
// nei kritęs, nes supervizorius jo neperkels.
process.on("uncaughtException", (error) => {
    console.error(`Nesugauta klaida: ${error?.stack ?? error}`);
    if (!listening) process.exit(1);
});
process.on("unhandledRejection", (reason) => {
    console.error(`Nesugautas rejection: ${reason?.stack ?? reason}`);
    if (!listening) process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        console.log(`\n${signal} — stojam.`);
        server.close(() => process.exit(0));
    });
}
