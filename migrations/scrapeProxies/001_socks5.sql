-- socks5 transporto dokumentavimas `scrapeProxies` lentelėje.
-- Duomenų struktūra nesikeičia: `type` ir anksčiau buvo laisvas tekstas,
-- pridedama tik nauja `type` reikšmė ir `url` formato paaiškinimas.

COMMENT ON COLUMN "public"."scrapeProxies"."type" IS
    'Transportas: httpReverse — reverse proxy, atkartojantis šaltinio kelius; socks5 — SOCKS5 tunelis. Šaltinio adresas scrapeLog''e nesikeičia nei vienu atveju.';

COMMENT ON COLUMN "public"."scrapeProxies"."url" IS
    'httpReverse: bazinis proxy adresas (http://10.1.10.2:9203). socks5: socks5://user:pass@ip:port (prisijungimo duomenys neobligatoriški, portas be nurodymo — 1080).';
