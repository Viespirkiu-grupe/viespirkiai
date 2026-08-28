# Astro SSR (standalone) frontend.
#
# Statoma dviem etapais: `builder` paleidžia `npm run build` (astro build +
# linkPublic), o galutinis `runtime` image'as turi TIK node_modules + dist/ +
# start-server.mjs. Konfigūracija paduodama per .env (env_file compose.yml),
# o public/, modules/ ir /flashas duomenų katalogai primontuojami runtime metu.
#
# Reikia BuildKit (numatytas moderniame Docker; CI nustatyti DOCKER_BUILDKIT=1)
# dėl `--mount=type=cache` npm cache mount'ų.

# `npm ci` lūžta su „Missing: tokenizers-* from lock file", jei package-lock.json
# neturi tuščių optional stub'ų `node_modules/tokenizers/node_modules/*`.
# Priežastis: `tokenizers@0.13.3` deklaruoja 13 platforminių optionalDependencies,
# kurių tokia versija registre neišleista (404) — `npm install` jas tyliai
# praleidžia, o `npm ci` reikalauja įrašo kiekvienai. Stub'ai laikomi lock faile
# rankomis; paleidus `npm install`/`npm uninstall` juos reikia grąžinti.

# ---- deps: TIK produkcinės priklausomybės (be devDependencies) ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---- builder: pilnos priklausomybės + build ----
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Šaltinis (config.js build'ui nereikia – astro.config.mjs jo neimportuoja)
COPY . .

# Commit'o hash'as footer'iui. Paprastai jo paduoti nereikia – build'as jį
# nuskaito iš .git/HEAD (į kontekstą įleisti tik HEAD ir refs, žr.
# .dockerignore). `--build-arg GIT_COMMIT=...` naudingas ten, kur .git
# nepasiekiamas (pvz. build iš archyvo).
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT

RUN npm run build

# ---- runtime ----
# OG paveikslėliai generuojami satori + resvg (utils/openGraphImage.js) —
# naršyklės nebereikia, tad ir sisteminio Chromium sluoksnio nebėra.
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Produkcinės priklausomybės iš deps (be typescript/vitest/tailwind/astro-check),
# statinis build'as iš builder'io. Konfigūracija per .env; public / modules
# montuojami per compose.
# --link: šie sluoksniai nepriklauso nuo bazinio image'o, tad BuildKit juos
# perpanaudoja tarp build'ų ir greičiau eksportuoja.
COPY --link --from=deps /app/node_modules ./node_modules
COPY --link --from=builder /app/dist ./dist
COPY --link --from=builder /app/start-server.mjs ./
COPY --link --from=builder /app/requestLog.mjs ./
# Paleistos versijos commit'as (footer'iui) – sugeneruotas build metu iš .git
# arba iš GIT_COMMIT build-arg'o. Žr. scripts/writeBuildInfo.mjs.
COPY --link --from=builder /app/build-info.json ./
# Šriftai ir logotipas OG generavimui — openGraphImage.js juos skaito iš
# src/assets santykinai nuo cwd (/app) runtime metu.
COPY --link --from=builder /app/src/assets/fontai ./src/assets/fontai
COPY --link --from=builder /app/src/assets/branding ./src/assets/branding

# Prievadą nustato start-server.mjs iš .env PORT (numatytas 9019). network_mode: host,
# tad EXPOSE tik informacinis.
EXPOSE 9019

CMD ["node", "start-server.mjs"]
