let vpTree = {};
let vpIsOpen = false;

async function vpLoadTree() {
    vpTree = await fetch((window._chatbotBase || '') + "tree.json").then((r) => r.json());
}

function vpTypeTokens(element, text) {
    return new Promise((resolve) => {
        const tokens = text.split(/(\s+)/);
        let i = 0;
        element.textContent = "";

        function next() {
            if (i >= tokens.length) { resolve(); return; }
            element.textContent += tokens[i];
            const msgs = document.getElementById("vp-messages");
            msgs.scrollTop = msgs.scrollHeight;
            i++;
            const isSpace = /^\s+$/.test(tokens[i - 1]);
            setTimeout(next, isSpace ? 0 : 50 + Math.random() * 60);
        }
        next();
    });
}

function vpAddUserMsg(text) {
    const msgs = document.getElementById("vp-messages");
    const div = document.createElement("div");
    div.className = "vp-msg user";
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}

function vpShowOptions(options) {
    const area = document.getElementById("vp-options");
    area.innerHTML = "";
    const msgs = document.getElementById("vp-messages");
    options.forEach((opt, idx) => {
        const btn = document.createElement("button");
        btn.className = "vp-opt";
        btn.textContent = opt.text;
        btn.style.setProperty("--i", idx);
        btn.onclick = () => {
            vpAddUserMsg(opt.text);
            area.innerHTML = "";
            const dot = document.getElementById("vp-notif-dot");
            if (dot) dot.classList.add("hidden");
            setTimeout(() => vpShowNode(opt.next), 350 + Math.random() * 300);
        };
        area.appendChild(btn);
    });
    requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

async function vpShowBotMessage(part, april) {
    const msgs = document.getElementById("vp-messages");

    const indicator = document.createElement("div");
    indicator.className = "vp-msg bot vp-typing";
    indicator.innerHTML = "<span></span><span></span><span></span>";
    msgs.appendChild(indicator);
    msgs.scrollTop = msgs.scrollHeight;

    await new Promise((r) => setTimeout(r, 650 + Math.random() * 600));
    msgs.removeChild(indicator);

    if (part.img) {
        const a = document.createElement("a");
        a.href = part.href;
        a.target = "_blank";
        a.rel = "noopener";
        a.className = "vp-msg bot img-msg" + (april ? " april" : "");
        const img = document.createElement("img");
        img.src = part.img;
        img.style.cssText = "display:block;width:100%;border-radius:6px;cursor:pointer;";
        a.appendChild(img);
        msgs.appendChild(a);
        msgs.scrollTop = msgs.scrollHeight;
    } else {
        const bubble = document.createElement("div");
        bubble.className = "vp-msg bot" + (april ? " april" : "");
        msgs.appendChild(bubble);
        await vpTypeTokens(bubble, part.text);
    }
}

async function vpShowNode(key) {
    const node = vpTree[key];
    if (!node) return;

    const parts = Array.isArray(node.bot)
        ? node.bot
        : [{ text: node.bot }];

    for (const part of parts) {
        await vpShowBotMessage(part, node.april);
    }

    if (node.options && node.options.length) {
        vpShowOptions(node.options);
    }
}

function vpToggleChat() {
    vpIsOpen ? vpCloseChat() : vpOpenChat();
}

function vpOpenChat() {
    vpIsOpen = true;
    const win = document.getElementById("vp-window");
    win.classList.remove("closing");
    win.classList.add("open");
    if (document.getElementById("vp-messages").children.length === 0) {
        setTimeout(() => vpShowNode("start"), 300);
    }
}

function vpCloseChat() {
    vpIsOpen = false;
    const win = document.getElementById("vp-window");
    win.classList.add("closing");
    setTimeout(() => { win.classList.remove("open", "closing"); }, 200);
}

function vpRestartChat() {
    document.getElementById("vp-messages").innerHTML = "";
    document.getElementById("vp-options").innerHTML = "";
    setTimeout(() => vpShowNode("start"), 200);
}

vpLoadTree().catch((err) => {
    console.error("Nepavyko įkelti sprendimų medžio:", err);
});
