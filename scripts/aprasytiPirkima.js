#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadEnvFile } from "../utils/configEnv.js";
import { runPirkimoAprasas } from "../modules/viesiejiPirkimai/pirkimoAprasasHarness.js";

function usage() {
    return "Naudojimas: npm run pirkimas:aprasas -- <pirkimo-numeris>";
}

export function mcpAdapter(module) {
    const inputSchema = z.object(module.schema);
    const jsonSchema = z.toJSONSchema(inputSchema);
    delete jsonSchema.$schema;

    return {
        definition: {
            type: "function",
            function: {
                name: module.name,
                description: module.description,
                parameters: jsonSchema,
            },
        },
        validate: (args) => inputSchema.parse(args),
        handler: module.handler,
    };
}

function parseResult(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function kiekis(value, vienas, keli, daug) {
    const number = Number(value);
    const lastTwo = Math.abs(number) % 100;
    const last = lastTwo % 10;
    if (last === 1 && lastTwo !== 11) return `${number} ${vienas}`;
    if (last >= 2 && last <= 9 && (lastTwo < 10 || lastTwo >= 20)) {
        return `${number} ${keli}`;
    }
    return `${number} ${daug}`;
}

export function toolStartText(name, args) {
    if (name === "get_viesasis_pirkimas") {
        return `Kraunami pirkimo ${args.pirkimoId} duomenys…`;
    }
    if (name === "get_failas") {
        return `Skaitomas dokumentas #${args.id}…`;
    }
    if (name === "get_failas_tekstas") {
        const nuo = args.puslapis ?? 1;
        const iki = nuo + (args.kiekis ?? 3) - 1;
        return `Skaitomi dokumento #${args.id} puslapiai ${nuo}–${iki}…`;
    }
    return `Vykdomas ${name}…`;
}

export function toolResultText(event) {
    if (event.isError) {
        return `Nepavyko: ${event.text.replace(/\s+/g, " ").slice(0, 240)}`;
    }

    const data = parseResult(event.text);
    if (event.name === "get_viesasis_pirkimas" && data) {
        const failai = data.turinys?.failai ?? [];
        return `Pirkimo duomenys · ${kiekis(failai.length, "dokumentas", "dokumentai", "dokumentų")}`;
    }
    if (event.name === "get_failas" && data) {
        const pavadinimas = data.pavadinimas ? `„${data.pavadinimas}“` : `#${data.id ?? "?"}`;
        const puslapiai = data.puslapiuSkaicius ?? data.tekstasMeta?.docPuslapiuIsviso;
        const dalys = [];
        if (puslapiai != null) dalys.push(`${puslapiai} psl.`);
        if (data.zodziuSkaicius != null) {
            dalys.push(kiekis(data.zodziuSkaicius, "žodis", "žodžiai", "žodžių"));
        }
        if (data.archyvoTuriniai?.length) {
            dalys.push(`${kiekis(data.archyvoTuriniai.length, "failas", "failai", "failų")} archyve`);
        }
        return `${pavadinimas}${dalys.length ? ` · ${dalys.join(" · ")}` : ""}`;
    }
    if (event.name === "get_failas_tekstas" && data?.meta) {
        const meta = data.meta;
        return `Puslapiai ${meta.rodomiPuslapiai} iš ${meta.docPuslapiuIsviso}${meta.yraDaugiau ? "" : " · dokumentas baigtas"}`;
    }
    return "Duomenys gauti";
}

function progressRenderer(pirkimoId) {
    const tty = process.stderr.isTTY;
    const color = tty && !process.env.NO_COLOR;
    const ansi = {
        reset: color ? "\x1b[0m" : "",
        bold: color ? "\x1b[1m" : "",
        dim: color ? "\x1b[2m" : "",
        cyan: color ? "\x1b[36m" : "",
        green: color ? "\x1b[32m" : "",
        red: color ? "\x1b[31m" : "",
    };
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let frame = 0;
    let activeText = "";
    let lastNonTtyText = "";

    process.stderr.write(`${ansi.bold}Pirkimas #${pirkimoId}${ansi.reset}\n\n`);

    const status = (text, animate = false) => {
        activeText = text;
        if (tty) {
            const symbol = animate ? frames[frame++ % frames.length] : "…";
            process.stderr.write(`\r\x1b[2K${ansi.cyan}${symbol}${ansi.reset} ${text}`);
        } else if (text !== lastNonTtyText) {
            process.stderr.write(`… ${text}\n`);
            lastNonTtyText = text;
        }
    };

    const done = (text, isError = false) => {
        if (tty) process.stderr.write("\r\x1b[2K");
        const symbol = isError
            ? `${ansi.red}✗${ansi.reset}`
            : `${ansi.green}✓${ansi.reset}`;
        process.stderr.write(`${symbol} ${text}\n`);
        activeText = "";
        lastNonTtyText = "";
    };

    return (event) => {
        switch (event.type) {
            case "step_start":
                status("Laukiama DI atsakymo…");
                break;
            case "reasoning_delta":
            case "reasoning_detail":
                status("Laukiama DI atsakymo…", true);
                break;
            case "content_delta":
                status("Rengiamas aprašymas…", true);
                break;
            case "tool_start":
                status(toolStartText(event.name, event.args), true);
                break;
            case "tool_result":
                done(toolResultText(event), event.isError);
                break;
            case "retry":
                status(`Ryšys strigo, kartojama (${event.attempt}/2)…`, true);
                break;
            case "heartbeat":
                if (activeText) status(activeText, true);
                break;
            case "complete":
                done("Aprašymas parengtas");
                break;
        }
    };
}

export async function main(argv = process.argv.slice(2)) {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(usage());
        return;
    }

    const pirkimoId = argv[0];
    if (!/^\d+$/.test(pirkimoId ?? "")) throw new Error(usage());

    loadEnvFile(process.cwd());
    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error("Nenustatytas OPENROUTER_API_KEY. Įrašykite jį į aplinką arba .env failą.");
    }

    // Importuojami tik pirkimo ir jo failų MCP įrankiai. Analitikos
    // get_schema / execute_query šiame eksperimente sąmoningai nėra.
    const [getViesasisPirkimas, getFailas, getFailasTekstas, { postgres }] = await Promise.all([
        import("../modules/mcp/tools/getViesasisPirkimas.js"),
        import("../modules/mcp/tools/getFailas.js"),
        import("../modules/mcp/tools/getFailasTekstas.js"),
        import("../postgres/postgres.js"),
    ]);

    try {
        const onEvent = progressRenderer(pirkimoId);
        const answer = await runPirkimoAprasas({
            pirkimoId,
            apiKey: process.env.OPENROUTER_API_KEY,
            tools: [getViesasisPirkimas, getFailas, getFailasTekstas].map(mcpAdapter),
            onEvent,
        });
        onEvent({ type: "complete" });
        process.stderr.write("\n");
        console.log(answer);
    } finally {
        await postgres.end();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
