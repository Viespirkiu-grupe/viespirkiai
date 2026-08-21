/**
 * Redakcijų pasirinkimas rodyklėmis, kai datos nenurodytos. Sąmoningai
 * minimalus, kaip ir `utils/pager.js`: raw režimas, ANSI, jokių bibliotekų.
 */
const INVERSE = "\x1b[7m";
const RESET_ALL = "\x1b[0m";

function eilute(r, pazymeta) {
    const zyme = pazymeta ? `[${pazymeta}]` : r.turiTeksta ? " · " : " × ";
    const laikotarpis = `${r.nuo} – ${r.iki ?? "…"}`;
    const uodega = r.turiTeksta ? "" : "  (teksto neturime)";
    return `${zyme} ${laikotarpis}  ${r.editionToken}${uodega}`;
}

/**
 * @returns dvi redakcijos senumo tvarka, arba `null`, kai naudotojas nutraukė.
 */
export async function pasirinktiRedakcijas(
    rows,
    { input = process.stdin, output = process.stdout } = {},
) {
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
        throw new Error("Nurodyk dvi datas (YYYY-MM-DD) – terminalas neinteraktyvus.");
    }
    if (rows.filter((r) => r.turiTeksta).length < 2) {
        throw new Error("Palyginimui reikia bent dviejų redakcijų su tekstu.");
    }

    let zymeklis = rows.findIndex((r) => r.turiTeksta);
    const pasirinkta = [];
    let pieštaEiluciu = 0;
    const wasRaw = input.isRaw === true;
    const langas = Math.max(5, (output.rows ?? 24) - 5);

    function piešti() {
        if (pieštaEiluciu) output.write(`\x1b[${pieštaEiluciu}A\x1b[0J`);
        const pradzia = Math.min(
            Math.max(0, zymeklis - Math.floor(langas / 2)),
            Math.max(0, rows.length - langas),
        );
        const plotis = output.columns ?? 80;
        const eilutes = rows.slice(pradzia, pradzia + langas).map((r, i) => {
            const idx = pradzia + i;
            const nr = pasirinkta.indexOf(idx);
            // Apkarpom, kad siaurame terminale eilutė neapsivyniotų ir
            // perpiešimas (`\x1b[<n>A`) nenuslystų.
            const tekstas = eilute(r, nr === -1 ? null : nr === 0 ? "A" : "B").slice(0, plotis);
            return idx === zymeklis ? `${INVERSE}${tekstas}${RESET_ALL}` : tekstas;
        });
        eilutes.push(
            `${INVERSE}-- ↑/↓ rinktis, Enter pažymėti (${pasirinkta.length}/2), q baigti --${RESET_ALL}`,
        );
        output.write(`${eilutes.join("\n")}\n`);
        pieštaEiluciu = eilutes.length;
    }

    // Redakcijos be teksto praleidžiamos – jų vis tiek nepalygintum.
    function judinti(kryptis) {
        for (let i = zymeklis + kryptis; i >= 0 && i < rows.length; i += kryptis) {
            if (rows[i].turiTeksta) {
                zymeklis = i;
                return;
            }
        }
    }

    input.setRawMode(true);
    input.resume();
    try {
        piešti();
        while (pasirinkta.length < 2) {
            const key = (await new Promise((resolve) => input.once("data", resolve))).toString();
            if (key === "q" || key === "Q" || key === "\u0003" || key === "\u001b") return null;
            if (key === "\u001b[A" || key === "k") judinti(-1);
            else if (key === "\u001b[B" || key === "j") judinti(1);
            else if (key === "\r" || key === "\n" || key === " ") {
                const jau = pasirinkta.indexOf(zymeklis);
                if (jau === -1) pasirinkta.push(zymeklis);
                else pasirinkta.splice(jau, 1);
            }
            piešti();
        }
    } finally {
        input.setRawMode(wasRaw);
        if (!wasRaw) input.pause();
    }
    return pasirinkta.map((i) => rows[i]).sort((a, b) => a.nuo.localeCompare(b.nuo));
}
