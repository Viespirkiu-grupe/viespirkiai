(() => {
    const PATH = "/external/deklaracijos/viesa";

    /* ---------- STORAGE ---------- */
    const uuids = new Set();
    window.__pinregUuids = uuids;

    /* ---------- UI ---------- */
    const box = document.createElement("div");
    box.innerHTML = `
    <div style="font-weight:bold; margin-bottom:4px;"><span style="color:red">●</span> PINREG UUID intercept</div>
    <div>Rastos deklaracijos: <span id="pr-unique">0</span></div>
    <button id="pr-copy">Kopijuoti UUID sąrašą</button>
    <div style="margin-top:6px; font-size:10px;">
      <i><a href="https://viespirkiai.org/pinreg/scrape" target="_blank" style="color:#fff; text-decoration:none;">Pilietinė iniciatyva Viešpirkiai</a></i>
    </div>
  `;
    Object.assign(box.style, {
        position: "fixed",
        top: "8px",
        left: "8px",
        zIndex: 999999,
        background: "#000",
        color: "#fff",
        padding: "10px",
        font: "12px monospace",
        borderRadius: "6px",
        boxShadow: "0 0 8px rgba(0,0,0,.5)",
    });

    const copyBtn = box.querySelector("#pr-copy");
    Object.assign(copyBtn.style, {
        display: "block",
        marginTop: "6px",
        background: "#000",
        color: "#fff",
        border: "1px solid #fff",
        borderRadius: "4px",
        padding: "4px 8px",
        cursor: "pointer",
        font: "12px monospace",
    });

    document.body.appendChild(box);

    const countEl = box.querySelector("#pr-unique");
    const updateCount = () => (countEl.textContent = uuids.size);

    /* ---------- URL MATCH ---------- */
    const isTarget = (url) => {
        if (!url) return false;
        try {
            const u = new URL(url, location.origin);
            return u.pathname === PATH;
        } catch {
            return url.includes(PATH);
        }
    };

    /* ---------- PROCESS RESPONSE ---------- */
    const processBody = (text) => {
        try {
            const data = JSON.parse(text);
            const content = data.content;
            if (Array.isArray(content)) {
                content.forEach((item) => {
                    if (item.accessUuid) uuids.add(item.accessUuid);
                });
                updateCount();
            }
        } catch (e) {
            console.warn("[processBody] invalid JSON", e);
        }
    };

    /* ---------- FETCH HOOK ---------- */
    if (!window.__pinregFetchHook) {
        window.__pinregFetchHook = true;
        const origFetch = window.fetch;

        window.fetch = async (...args) => {
            const res = await origFetch(...args);
            const url = typeof args[0] === "string" ? args[0] : args[0]?.url;

            if (isTarget(url)) {
                try {
                    const clone = res.clone();
                    const text = await clone.text();
                    processBody(text);
                } catch (e) {
                    console.error("[fetch capture error]", e);
                }
            }
            return res;
        };
    }

    /* ---------- XHR HOOK ---------- */
    if (!window.__pinregXhrHook) {
        window.__pinregXhrHook = true;

        const oOpen = XMLHttpRequest.prototype.open;
        const oSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (m, u, ...r) {
            this.__url = u;
            return oOpen.call(this, m, u, ...r);
        };

        XMLHttpRequest.prototype.send = function (...a) {
            this.addEventListener("load", () => {
                if (isTarget(this.__url)) {
                    processBody(this.responseText);
                }
            });
            return oSend.apply(this, a);
        };
    }

    /* ---------- COPY BUTTON ---------- */
    copyBtn.onclick = () => {
        if (!uuids.size) return alert("Nėra surinktų UUID");
        const text = Array.from(uuids).join("\n");
        navigator.clipboard
            .writeText(text)
            .then(() => {
                alert(`Kopijuota ${uuids.size} UUID`);
            })
            .catch((e) => {
                console.error("[copy failed]", e);
            });
    };

    console.info("PINREG UUID interception active");
})();
