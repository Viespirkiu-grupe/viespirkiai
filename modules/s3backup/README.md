# s3backup — viso failų archyvo backup į S3

~3,8 mln. unikalių md5, ~7200 GB. Failų baitų šiame hoste nėra: jie gyvena
„dėžėse", o priešais jas stovi vidinis mazgas `http://10.1.10.1:4000/<md5>`.
Todėl backup'as = **parsisiųsk iš mazgo → įkelk į S3**.

## Paruošimas

```bash
npm install                                   # @aws-sdk/client-s3, @aws-sdk/lib-storage
cp modules/s3backup/.env.sample modules/s3backup/.env
$EDITOR modules/s3backup/.env                 # endpoint, bucket, raktai
```

## Naudojimas

```bash
# 1. Eilės sudarymas (inkrementinis, resuminamas, galima leisti nuolat)
npm run s3backup:queue
npm run s3backup:queue -- --limit 1000        # testui

# 2. Įkėlimas
npm run s3backup:upload -- --mazgas hetzner --concurrency 24
npm run s3backup:upload -- --mazgas hetzner --limit 20 --concurrency 4   # testui

# 3. Būsena
npm run s3backup:status -- --mazgas hetzner
npm run s3backup:status -- --visi

# 4. Vieno failo parsiuntimas (atkūrimas / patikra)
npm run s3backup:get -- 000082b3f1da7489e07e43ae5819d15c
npm run s3backup:get -- viespat/failai/00/00/82/000082b3f1da7489e07e43ae5819d15c
npm run s3backup:get -- <md5> --i /tmp/failas.pdf
npm run s3backup:get -- <md5> --i - | md5sum      # į stdout
```

Eilę galima pildyti **kol įkėlimas sukasi** — tai du atskiri procesai virš tos
pačios WAL režimo SQLite bazės. Nauji md5 paimami kitame įkėlimo rate.

### Vėliavėlės

| Vėliavėlė | Kur | Reikšmė |
|---|---|---|
| `--mazgas <alias>` | upload, status | kuris S3 mazgas iš `S3_NODES` |
| `--concurrency <n>` | upload | lygiagretūs failai (default iš `.env`) |
| `--limit <n>` | queue, upload | apdoroti daugiausiai N (testams) |
| `--page <n>` | queue | md5 per Postgres užklausą |
| `--nuo-pradziu` | queue | ignoruoti kursorių, perskaityti viską |
| `--tikrinti-s3` | upload | prieš keliant daryti `HeadObject` |
| `--valyti-klaidas` | upload | atrakinti md5, pasiekusius `MAX_RETRIES` |
| `--visi` | status | rodyti visus mazgus |
| `--paskutiniai <n>` | status | kiek paskutinių įkeltų parodyti (default 5) |
| `--i <kelias\|->` | get | kur išsaugoti (`-` = stdout; default `./<md5>`) |
| `--db <kelias>` | visur | kita SQLite bazė |

## Kaip veikia

```
s3backupQueue.js   Postgres ──keyset(filesMd5.id)──> SQLite `eile`
s3backupUpload.js  `eile` ──> 10.1.10.1:4000 ──> S3 ──> `ikelti` / `klaidos`
s3backupStatus.js  ataskaita
```

**Eilės šaltinis:** `filesMd5` ∩ `files."downloadStatus" = 1` (tik md5, kuriems
realiai yra parsiųstas failas). Dydis — `filesMd5Boxes.filesize`.

**S3 raktas:** `<prefix>ab/cd/ef/<md5>` — skaidymas išbarsto 3,8 mln. objektų,
todėl listinimas ir dalinis atkūrimas nemiršta. Plėtinys nesvarbus; raktas yra
turinio md5.

**Mažas / didelis:** iki `INLINE_MAX_BYTES` (25 MB) failas laikomas RAM'e ir
keliamas vienu `PutObject` su `Content-MD5`; didesnis persiliejamas į `TEMP_DIR`
ir keliamas multipart'u. Nežinomas dydis (`0`) nieko negadina — pradedama RAM'e
ir persijungiama peraugus slenkstį.

**Integralumas:** md5 skaičiuojamas parsisiuntimo srauto metu. Nesutapus su
laukiamu — į S3 **nekeliama**, įrašoma į `klaidos`.

**Piko atmintis** ≈ `CONCURRENCY × INLINE_MAX_BYTES` plius multipart buferiai;
tikslų skaičių scriptas išspausdina startuodamas.

## Crash-safety

Eilėje **nėra** jokio „claim"/lock stulpelio, o įrašas į `ikelti` atsiranda
**tik po** S3 patvirtinimo. Todėl:

- po `kill -9` ar dingus elektrai nieko atrakinti nereikia;
- neužfiksuotas md5 tiesiog paimamas iš naujo;
- pakartotinis įkėlimas idempotentiškas (raktas = turinio md5);
- blogiausia crash'o kaina — vienas pakartotinai keliamas failas, niekada
  neprarastas failas.

`TEMP_DIR` startuojant išvalomas nuo likusių `.part` failų. Bazė sukasi
`journal_mode = WAL`, `synchronous = NORMAL`.

`Ctrl+C` — darbininkai baigia pradėtus failus, būsena nuplaunama į SQLite,
procesas išeina švariai. Antras `Ctrl+C` — išeina iš karto.

## Atkūrimas

```bash
npm run s3backup:get -- $MD5              # išsaugo ./$MD5
npm run s3backup:get -- $MD5 --i - | md5sum
```

Bucket'as ir raktas imami iš `ikelti` lentelės, o jos neradus sudaromi iš mazgo
konfigūracijos (`<prefix>ab/cd/ef/<md5>`). Galima paduoti ir visą raktą, tiesiai
nukopijuotą iš `s3backup:status` išvesties.

Parsisiuntus md5 visada perskaičiuojamas ir lyginamas su rakto md5; nesutapus
failas ištrinamas ir grąžinamas exit 1.

## Lentelės (`SQLITE_PATH`)

| Lentelė | Paskirtis |
|---|---|
| `eile` | ką reikia įkelti: `md5`, `md5Id`, `dydis`, `pridetas` |
| `ikelti` | kas ir kur įkelta: `(md5, mazgas)` → `bucket`, `raktas`, `dydis`, `etag`, `ikeltas` |
| `klaidos` | `(md5, mazgas)` → `bandymai`, `paskutine`, `kada` |
| `bukle` | eilės kursorius (`queueCursor`) |

`(md5, mazgas)` raktas reiškia, kad tą patį archyvą galima nepriklausomai kelti
į kelis S3 mazgus, ir kiekvieno progresas sekamas atskirai.
