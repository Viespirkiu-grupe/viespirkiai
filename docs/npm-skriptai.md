# npm skriptai

Visų `package.json` „scripts" įrašų aprašymas: ką kiekvienas daro ir kada jį verta
leisti. Skyriai sugrupuoti pagal duomenų sritį, o ne pagal abėcėlę — vieno šaltinio
komandos beveik visada leidžiamos viena po kitos.

## 1. Kaip skaityti šį dokumentą

Prie kiekvienos komandos nurodyta, ar ji **automatizuota**, ar **rankinė**:

- **Automatizuota** — tą patį darbą nuolat suka `TaskRunner` (`runner/TaskRunner.js`,
  užduočių aprašai — `tasks/*.js`). Rankomis leidžiama tik derinant, po incidento
  arba kai reikia rezultato nelaukiant kito ciklo. Prie tokių nurodytas užduoties
  vardas ir jos `schedule` / režimas.
- **Rankinė** — TaskRunner jos neturi; leidžiama pagal poreikį (vienkartiniai
  importai, backfill'ai, ataskaitos, peržiūros).

Parametrai npm'ui paduodami po `--`:

```bash
npm run sodra:atnaujinti -- --force
```

Beveik visos duomenų komandos idempotentiškos ir tęsiamos po nutraukimo — kur ne,
tai pažymėta atskirai. Prisijungimai prie DB ir išorinių servisų imami iš aplinkos
kintamųjų; jų sąrašas — [`ENV.md`](../ENV.md).

## 2. Programos paleidimas, testai ir build'as

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run dev` | Astro dev serveris su hot reload. | Rankinė. Kasdieniam frontend'o darbui. |
| `npm run build` | `astro build` (be `public/` kopijavimo), tada `scripts/linkPublic.mjs` sukuria symlink'us `dist/client/* → public/*` (kad ~34 MB nebūtų dubliuojami) ir `scripts/writeBuildInfo.mjs` įrašo `build-info.json` su commit'o hash'u. | Rankinė. Prieš diegimą; Docker image'e vykdoma automatiškai. |
| `npm start` | Paleidžia sukompiliuotą serverį (`start-server.mjs`). | Rankinė. Produkcijoje / patikrinti build'o rezultatą. |
| `npm test` | Vitest vienetiniai testai (`vitest run`). | Rankinė. Prieš commit'ą ir PR'ą. |
| `npm run test:integration` | Vitest integraciniai testai (`vitest.integration.config.ts`) — reikia gyvos DB ir servisų. | Rankinė. Keičiant DB užklausas, eiles ar indeksavimą. |
| `npm run check` | `astro check` — TypeScript ir Astro tipų patikra. | Rankinė. Prieš commit'ą, kartu su testais. |

## 3. Duomenų bazės schema ir kodo priežiūra

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run db:schema:dump` | Gyvos DB schemą išrašo į `dbSchema/` po vieną `.sql` failą lentelei (su `COMMENT ON`). | Rankinė. Po kiekvienos schemos migracijos, kad `dbSchema/` atitiktų realybę. |
| `npm run db:schema:komentarai` | Parodo, kurios lentelės ir stulpeliai dar neturi `COMMENT ON`; su `--sql <šeima>` atspausdina tuščią šablono SQL. Nieko nekeičia. | Rankinė. Kai rašomi trūkstami lentelių aprašymai. |
| `npm run db:schema:rasytojai` | Skenuoja kodą ieškodamas `INSERT`/`UPDATE`/`COPY`/`DELETE` prie literalinių lentelių vardų ir į stdout išveda `UPSERT` SQL, kas į kurią lentelę rašo. Dinaminių vardų neaptinka. | Rankinė. Atnaujinant lentelių „rašytojų" registrą. |
| `npm run deps:report` | Iš `package-lock.json` suskaičiuoja priklausomybių dydžius į `tmp/`. | Rankinė. Prieš pridedant ar valant priklausomybes. |
| `npm run code:lines` | `cloc` pagalba suskaičiuoja kodo eilutes ir surašo medį į `codeLines.txt` (`--min=100`, `--out`). Reikia `cloc` (`apt install cloc`). | Rankinė. Apžvalgai, kur kaupiasi kodas. |

## 4. AI aprašymai ir rizikos vertinimas

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run pirkimas:aprasas -- <pirkimo-numeris>` | Sugeneruoja vieno pirkimo AI aprašą per MCP įrankius ir parodo eigą terminale. | Rankinė. Derinant promptus ar tikrinant konkretų pirkimą. |
| `npm run pirkimai:aprasyti` | Masinis aprašymų generavimas iš eilės, su lygiagretumo ir RPS ribojimu (`--limit`, `--concurrency`, `--log`). | Rankinė. Kai reikia pavyti backlog'ą greičiau, nei tai daro eilė. |
| `npm run pirkimai:aprasymu-eile` | `viesiejiPirkimaiAprasymaiQueue` eilės apdorojimas / būsena. Rezultatas rašomas į `viesiejiPirkimaiAprasymai`, o į Quickwit indeksą vėliau — atskiras draineris. | **Automatizuota** (`viesiejiPirkimaiAprasymuEile`). Rankomis — tik derinant; lygiagrečiai su `pirkimai:aprasyti` kyla lenktynių. |
| `npm run sutartys:aprasyti` | Tas pats aprašymų generavimas sutartims (`--limit`, `--concurrency`). | Rankinė. |
| `npm run risk:run` | Procurement Risk servisas: vienas nuoseklus visų indikatorių vertinimo paleidimas. `-- <pirkimoNumeris…>` — tik nurodyti pirkimai, `-- --limit 20` — determinuota 20 ATN-1 pirkimų imtis. | Rankinė. Planuoklio kol kas nėra — leidžiama rankomis arba iš išorinio cron'o. |

## 5. Viešieji pirkimai ir sutartys

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run scrape:planuojami-pirkimai` | Atnaujina EPPS planuojamus pirkimus (numatytai — paskutinės 7 dienos) į `eppsPlanuojamiPirkimai` schemą. | **Automatizuota** (`updateRecentPlanuojamiPirkimai`, `23 * * * *`). Rankomis — po prastovos arba tikrinant pataisą. |
| `npm run export:planuojami-pirkimai-jsonl` | Žemesnio lygio EPPS `searchPlan.do` eksportas nuo `2024-11-11` iki šiandien. | Rankinė. Pilnam persiskaitymui arba duomenų analizei. |
| `npm run sutartys:canonical-json -- <unikalusId>` | Nuskaito vieną sutartį iš eviesiejipirkimai.lt ir atspausdina jos kanoninį JSON. | Rankinė. Lyginant, ką šaltinis rodo dabar, su tuo, kas DB. |
| `npm run sutartys:rescrape-recent -- [minutės] [concurrency] [--dry-run]` | Iš naujo nuskaito neseniai matytas sutartis (numatytai 15 min., 5 gijos). | Rankinė. Po incidento, kai dalis įrašų nusėdo nepilni. |
| `npm run sutartys:changes -- [--limit N] [--id ID]` | Rodo sutarčių pakeitimų istoriją su diff'u; `--json`, `--pager`, `--color`. | Rankinė. Peržiūrai. |
| `npm run sutartys:dropEmptyChanges -- [--dry-run]` | Ištrina „nulinius" `vpmSutartys."changes"` įrašus, kur pasikeitė tik hash'as, bet ne kanoninio JSON laukai. **Keičia duomenis** — pirma leisk su `--dry-run`. | Rankinė. Valant istoriją. |
| `npm run export:sutartys` | Visos sutartys → `exports/sutartys.jsonl`. | Rankinė. Atviriems duomenims / analizei. |
| `npm run export:sutartys-canonical` | Kanoninis sutarčių JSON → `exports/sutartysCanonical.jsonl`. | Rankinė. |
| `npm run push:sutartys -- [--after ID] [--batch N] [--dry-run]` | Visų sutarčių sinchronizacija į Spintą (ADP). | Rankinė. Vienkartinis arba atsistatymo paleidimas. |
| `npm run process:sutartys-adp-queue` | Nudrenuoja `vpmSutartys."adpQueue"` į Spintą po vieną eilutę. | **Automatizuota** (`processSutartysAdpQueue`). Rankomis — derinant arba pavyti susikaupusią eilę. |

## 6. Juridiniai asmenys (JAR)

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run juridiniai:atnaujinti` | Parsiunčia ir importuoja RC JAR CSV (su `etag`/`Last-Modified`/`sha256` patikra) bei sinchronizuoja žodynus. | **Automatizuota** (`atnaujintiJarCsv`, `20 1 * * *`). Rankomis — kai naujas failas reikalingas nelaukiant nakties. |
| `npm run juridiniai:papildomi -- [--force]` | Papildomi RC JAR rinkiniai: finansinės ataskaitos, NVO / paramos gavėjai, savanorystė, JANGIS, dokumentai, JADIS dalyviai. | **Automatizuota** (`atnaujintiJarPapildomusDuomenis`, `20 2 * * *` — sąmoningai po pagrindinio importo). |
| `npm run juridiniai:process -- [--batch-size N]` | Apdoroja `juridiniai` atnaujinimo eilę: perkelia pakeitimus iš `rcJar."asmenys"` į `juridiniai."juridiniai"`. | **Automatizuota** (`juridiniaiRefreshQueue`). Rankomis — pavyti eilę po didelio importo. |
| `npm run juridiniai:backfill -- [--batch-size N]` | Pilnas `juridiniai` lentelės perstatymas iš JAR šaltinio (su sesijos užraktu). | Rankinė. Po mapping'o ar schemos pakeitimo. |
| `npm run export:juridiniai-jsonl` | Visi JAR juridiniai asmenys → `exports/juridiniai.jsonl` (`--tik-registruoti`, `--limit`). Srautinama kursoriumi, rikiuojama pagal `jarKodas`. | Rankinė. |
| `npm run rcjar:dokumentai:eile` | Į `rcJar."dokumentuEile"` sudeda JAR kodus, kurių ten dar nėra. | **Automatizuota** (`papildytiRcJarDokumentuEile`, `23 4 * * *`). |
| `npm run rcjar:dokumentai:scrape` | Nuskaito registrucentras.lt `dok.php` — pilną JAR pateiktų dokumentų sąrašą (atviri duomenys turi tik steigimo dokumentus). Tempą riboja `RC_JAR_DOKUMENTAI_RPS` ir eilės `nextAttempt`. | **Automatizuota** (`nuskaitytiRcJarDokumentus`). |

## 7. ES investicijos ir CPVA

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run esinvesticijos:sarasas` | 2014.esinvesticijos.lt paraiškų/projektų sąrašas (~40 tūkst. įrašų, 41 užklausa po 1000 eilučių) į `"2014esInvesticijos"`. Pasikeitusiems projektams nunulina `detalesNuskaitytos`. | **Automatizuota** (`atnaujintiEsInvesticijosSarasa`, `47 */3 * * *`). |
| `npm run esinvesticijos:detales` | Projektų puslapiai: savivaldybė, priemonė, aprašymas, rodikliai, pirkimų skelbimai. Eilė — `detalesNuskaitytos IS NULL`. | **Automatizuota** (`nuskaitytiEsInvesticijosDetales`). |
| `npm run esinvesticijos:priemones` | ~263 priemonės su `slug`, per kurį projektai su jomis siejami. | **Automatizuota** (`nuskaitytiEsInvesticijosPriemones`, `20 4 * * *`). |
| `npm run esinvesticijos:jar-kodai` | Pareiškėjų pavadinimus paverčia JAR kodais (kartą įmonei, ne kiekvienai paraiškai). | **Automatizuota** (`rastiEsInvesticijosPareiskejoJarKoda`). Rankomis — pakėlus paieškos versiją, kai visus reikia peržiūrėti iš naujo. |
| `npm run cpva:projektai` | CPVA administruojamų projektų ir tiekėjų XLSX → `cpva` schema. | **Automatizuota** (`nuskaitytiCpvaProjektaiTiekejai`, `0 */1 * * *`). |

## 8. Kiti registrai ir šaltiniai

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run adresuRegistras:importuoti` | Visos `adresuRegistras` schemos lentelės vienu paleidimu. `-- gatves adresai` — tik nurodyti žingsniai, `-- --sarasas` — žingsnių sąrašas. Eiliškumas svarbus: ribų importai pabaigoje sinchronizuoja `juridiniai` žodynus. | Rankinė. Pasirodžius naujam Adresų registro leidimui. |
| `npm run regitra:atnaujinti -- [--force]` | Regitros transporto parko duomenys; pigus `HEAD` — siunčia tik pasikeitus `etag`/`Last-Modified`. | **Automatizuota** (`atnaujintiRegitrosDuomenis`, `40 2 * * *` — Regitra skelbia kartą per mėnesį nežinomu laiku). |
| `npm run sodra:atnaujinti -- [--force] [--metai 2019]` | Sodros duomenys; taip pat per `HEAD`. Sausį–kovą kartu tikrinami ir praėjusių metų failai. | **Automatizuota** (`atnaujintiSodrosDuomenis`, `10 3 * * *`). |
| `npm run kotis:atrasti -- [--mode incremental\|recentReconcile\|fullReconcile] [--from/--to/--days] [--wait-lock]` | KOTIS (valstybės pagalbos) sąrašo puslapiavimas į atradimų eilę; su sesijos užraktu, numatytai `fullReconcile`. | Rankinė. |
| `npm run kotis:apdoroti -- [--concurrency N] [--max-attempts N] [--limit N]` | KOTIS kortelių detalės iš atradimų eilės į normalizuotas lenteles. | Rankinė. Iš karto po `kotis:atrasti`. |
| `npm run vptAtaskaitos:importuoti` | VPT apjungtų ataskaitų XLSX (iš `modules/vptXlsxApjungtosAtaskaitos/data/`, į git nepatenka) tiesiai į reliacines lenteles. Idempotentiškas. Schema pritaikoma atskirai (`vptXlsxApjungtosAtaskaitos1.sql`). | Rankinė. Gavus naujus VPT failus. |
| `npm run ppa:discover -- [--dry-run]` | Quickwit'e pagal turinio frazę suranda PPA XLSX failus ir pažymi juos `files."specialTypes"`. Jau pažymėtų neperrašo. | Rankinė. |
| `npm run ppa:parse -- [--concurrency=N]` | Pažymėtus PPA XLSX išparsina į `ppa` schemą (pasiūlymų vertinimo lentelės). | Rankinė. Po `ppa:discover`. |

## 9. Teisės aktai ir teismų sprendimai

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run liteko2:klasifikatoriai` | Sinchronizuoja LITEKO2 klasifikatorius (teismus, bylų rūšis, dokumentų tipus, kategorijas). Eilučių netrina — seni kodai lieka. | **Automatizuota** (`liteko2Klasifikatoriai`, `15 4 * * *`). |
| `npm run liteko2:scrape` | LITEKO2 sprendimų inventorius į `liteko2.sprendimai` (nuo paskutinės DB datos −7 d.). `--visi` — visa istorija, `--nuo/--iki` — intervalas. Papildomai pažymi atšauktus sprendimus. | **Automatizuota** (`scrapeLiteko2`, `30 */6 * * *`). |
| `npm run liteko2:turinys -- [--limit N]` | Sprendimo turinys: metaduomenys, šalys, teisėjai, kategorijos, failai; pilnas atsakymas, HTML ir tekstas — tik į sidecar'ą, ne į DB. | **Automatizuota** (`scrapeLiteko2Turinys`). |
| `npm run eseimas:scrape` | e-Seimo nuskaitymas etapais: `--stage days\|documents\|editions\|asr\|historical\|all`, taip pat `--day`, `--discover`, `--promised`, `--status`, `--force`, `--concurrency`. | **Automatizuota** (`eSeimasDiscoverRecentDays`, `eSeimasScrapeDocuments`, `eSeimasScrapeEditionLists`, `eSeimasScrapeAsr`, `eSeimasScrapeHistorical` — visi tik jei nustatytas `ETAR_API_URL`). Rankomis — istorijai užpildyti ir būsenai pažiūrėti (`--status`). |
| `npm run etar:dokumentai:audit` | Palygina `"eTar"."legalActDocument"` su `documents` — kiek trūksta, kiek pasenę, kiek likę be šaltinio. Nieko nekeičia. | Rankinė. Pirmas žingsnis įtarus nepilną dokumentų aprėptį. |
| `npm run etar:dokumentai:backfill` | Tą patį skirtumą užpildo — sudeda trūkstamus e-TAR dokumentus į eilę. | Rankinė. Po audito. |
| `npm run etar:dokumentai:process` | Nudrenuoja `"eTar"."documentsQueue"` į `documents` lentelę. | **Automatizuota** (`processETarDocumentsQueue`). Rankomis — pavyti eilę po backfill'o. |
| `npm run teisekura:audit` | Aprėpties suvestinė per `public."teisekuraObjektai"`: kiek paruošta, laukia, klaidų, be dokumento. | **Automatizuota** (`auditTeisekuraCoverage`, `37 3 * * *`). Rankomis — patikrinti būklę bet kada. |
| `npm run teisekura:palyginti -- TAR.XXXX [data1 data2]` | Dviejų teisės akto suvestinių redakcijų palyginimas terminale; be datų redakcijas renkiesi iš sąrašo. | Rankinė. Peržiūrai. |

## 10. Failai, dokumentai ir sidecar'ai

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run failai:nuskaitymo-eile -- [--valyti]` | Suvienodina `files."extractionQueue"` su `files` lentele: prideda trūkstamus, su `--valyti` ištrina nebereikalingus. | Rankinė. Pakėlus `NUSKAITYMO_VERSIJA`, po rankinių DB korekcijų arba pakeitus plėtinius. |
| `npm run failai:photos-backfill` | Vienkartinis `files."photos"` užpildymas esamais failais (idempotentinis). Toliau lentelę palaiko pats nuskaitymas. | Rankinė. Tik prireikus persiskaičiuoti. |
| `npm run sidecars:sqlite-missing` | Palygina SQLite sidecar'ų turinį su Postgres referenciniais hash'ais ir parodo, ko trūksta (`failaiInfo`, `dokumentai`, `ocrRezultatai`, `liteko2`, TED ir kt.). | Rankinė. Prieš ir po sidecar'ų migracijų. |

## 11. Vektoriai (bge-m3)

Visos šios komandos rankinės — TaskRunner jų nesuka. Dirbama su atskira SQLite baze,
embedding'ai skaičiuojami per Ollamą.

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run vector:queue -- [--limit N] [--concurrency N]` | `cvpIs` failų tekstą sukapoja į bge-m3 langus ir sudeda į SQLite (be embeddinimo). Eina didėjančia `failai.id` tvarka, tad nutrūkus tęsia. | Rankinė. Pirmas žingsnis. |
| `npm run vector:embed -- [--url http://…:11434] [--concurrency N] [--batch N]` | Gabalams suskaičiuoja bge-m3 vektorius per Ollamą. Ima tik `vektorius IS NULL`, tad tęsia savaime. | Rankinė. Po `vector:queue`. |
| `npm run vector:inspect -- [--n N] [--full] [--hash <md5>]` | Eilės peržiūra: suvestinė ir keli atsitiktiniai gabalai su šaltiniais. Read-only, Postgres nereikia. | Rankinė. |
| `npm run vector:patikra -- [--knn <md5>] [--sample N]` | Dekoduoja vektorius, rodo dimensiją, normą, reikšmes; su `--knn` — artimiausius pagal kosinusą. | Rankinė. Patikrinti, ar embedding'ai sveiki. |
| `npm run vector:paieska -- <pirkimoNr> "<užklausa>" [--top N] [--irasyti]` | Testinė vektorinė paieška vieno pirkimo viduje (brute force, indekso nereikia). | Rankinė. |
| `npm run vector:bvpz:embed -- [--limit N] [--concurrency N]` | Tas pats BVPŽ kodų aprašams — į atskirą SQLite. | Rankinė. |
| `npm run vector:bvpz:paieska -- "<užklausa>" [--top 10]` | Semantinė BVPŽ kodų paieška. | Rankinė. |

## 12. Quickwit ir Typesense indeksai

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run quickwit:juridiniai` | Nudrenuoja `juridiniai` indeksavimo eilę į Quickwit (CLI palaiko `--concurrency` su stabiliu shard'u). | **Automatizuota** (`juridiniaiQuickwitProcessIndexQueue`, concurrency 1). Rankomis — greitesniam perindeksavimui. |
| `npm run juridiniai:typesense` | Nudrenuoja `juridiniai."typesenseQueue"` į Typesense (jis lieka dėl typo tolerancijos — nuo jo priklauso pavadinimo → `jarKodas` vertimas). | **Automatizuota** (`juridiniaiTypesenseProcessIndexQueue`, concurrency 1). |
| `npm run juridiniai:typesense:requeue` | Į eilę sudeda visus JAR kodus — pilnam indekso perstatymui. | Rankinė. Būtina pakėlus Typesense schemos versiją (kolekcija tada sukuriama iš naujo, tuščia). |
| `npm run quickwit:mcp-tool-calls` | MCP įrankių iškvietimų žurnalą (`mcp."toolCalls"`) indeksuoja į Quickwit. | **Automatizuota** (`mcpToolCallsQuickwitProcessIndexQueue`). |
| `npm run quickwit:requeue-live -- [indeksas…] [--top N] [--min-dead N] [--dry-run] [--all]` | Gyvas seno indekso eilutes grąžina į indeksavimo eilę ir per NATS pažadina atitinkamą darbą. | Rankinė. Prieš atsikratant seno shard'o. |
| `npm run quickwit:delete-dead-indexes` | Ištrina nebeaktualius Quickwit shard'us (gyvybingumas ir naujausio indekso apsauga tikrinama prieš pat trynimą). **Trina duomenis.** | **Automatizuota** (`deleteDeadQuickwitIndexes`, `43 3 * * *`). |
| `npm run quickwit:count-producer -- [--prefix] [gamintojas]` | Suskaičiuoja, kiek dokumentų sukurta konkrečiu PDF generatoriumi. | Rankinė. Ataskaitai. |
| `npm run quickwit:top-pdf-metadata` | Dažniausi PDF `creator`/`producer` metaduomenys → `tmp/*.txt`. | Rankinė. Ataskaitai. |

## 13. S3 atsarginės kopijos

Visos rankinės; eilė ir rezultatai laikomi SQLite, tad `queue` ir `upload` gali suktis
lygiagrečiai. Raktas — turinio md5, todėl pakartotinis įkėlimas idempotentiškas.

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run s3backup:queue` | Sudaro įkėlimo eilę: Postgres → SQLite `eile`. | Rankinė. Pirmas žingsnis; galima palikti suktis. |
| `npm run s3backup:upload -- --mazgas hetzner\|wasabi [--concurrency N] [--limit N] [--tikrinti-s3] [--valyti-klaidas]` | Parsiunčia iš vidinio mazgo ir kelia į S3; mažus failus vienu `PutObject`, didesnius multipart'u. md5 tikrinamas srauto metu — nesutapus nekelia. | Rankinė. |
| `npm run s3backup:status -- [--mazgas X] [--visi] [--paskutiniai N]` | Būsenos ataskaita: kiekiai, tempas, klaidų suvestinė. | Rankinė. |
| `npm run s3backup:klaidos -- [--kaip "HTTP 404%"] [--limit N] [--formatas md5\|jsonl] [--failas …]` | Klaidų išrašas po vieną md5 (suvestinę rodo `status`). | Rankinė. |
| `npm run s3backup:requeue` | Ištrina klaidų žymes, kad kitas `upload` bandytų iš naujo — įskaitant „nuolatines" (404, md5 nesutapimus). | Rankinė. Kai `upload` baigia per kelias sekundes, nors dalis failų neįkelta. |
| `npm run s3backup:get -- <md5\|kelias> [--i /tmp/failas.pdf\|-]` | Parsiunčia vieną failą iš backup'o. | Rankinė. Atkūrimui ir patikrinimui. |

## 14. Domenai

| Komanda | Ką daro | Kada leisti |
| --- | --- | --- |
| `npm run push:domenai -- [--after ID] [--batch N] [--limit N] [--dry-run] [--skip-scrapes]` | Visų domenų sinchronizacija į Spintą. | Rankinė. Vienkartinis / atsistatymo paleidimas. |
| `npm run process:domenai-adp-queue` | Nudrenuoja `domenai."adpQueue"` į Spintą po vieną eilutę. | **Automatizuota** (`processDomenaiAdpQueue`). |
