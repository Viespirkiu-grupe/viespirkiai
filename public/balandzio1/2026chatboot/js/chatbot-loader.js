(function () {
    const BASE = (document.currentScript || {src: '/balandzio1/2026/js/chatbot-loader.js'}).src
        .replace(/js\/[^/]+$/, '');

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = BASE + 'css/style.css';
    document.head.appendChild(link);

    function init() {
        document.body.insertAdjacentHTML('beforeend', `
            <button id="vp-toggle" onclick="vpToggleChat()" aria-label="Atidaryti pagalbą">
                <span id="vp-toggle-icon">💬</span>
                <span>Pagalba</span>
                <span id="vp-notif-dot" aria-hidden="true">1</span>
            </button>

            <div id="vp-window" role="dialog" aria-label="Pagalbos botas">
                <div id="vp-header">
                    <div id="vp-header-left">
                        <span id="vp-header-title">VIEŠPIRKIS</span>
                        <span id="vp-header-status"><span class="vp-status-dot"></span> online • beta</span>
                    </div>
                    <div id="vp-header-right">
                        <span class="vp-badge">AI</span>
                        <button id="vp-close" onclick="vpCloseChat()" aria-label="Uždaryti">✕</button>
                    </div>
                </div>
                <div id="vp-messages" aria-live="polite"></div>
                <div id="vp-options"></div>
                <div id="vp-footer">
                    <button id="vp-restart" onclick="vpRestartChat()">↺ pradėti iš naujo</button>
                    <span id="vp-powered">Powered by Mildė</span>
                </div>
            </div>
        `);

        window._chatbotBase = BASE;
        const script = document.createElement('script');
        script.src = BASE + 'js/bot.js';
        document.body.appendChild(script);
    }

    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    if (link.sheet || link.loaded) {
        onReady(init);
    } else {
        link.addEventListener('load', () => onReady(init));
        link.addEventListener('error', () => onReady(init));
    }
})();
