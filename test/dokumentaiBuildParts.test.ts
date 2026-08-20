import { describe, expect, it } from 'vitest';
import { buildPartsExcluding, buildPartsOpts } from '@/src/lib/searchDokumentai.ts';

// Charakterizacinis testas: fiksuoja TIKSLIAS buildPartsOpts/buildPartsExcluding
// išvestis, kad FACETS deskriptoriaus perrašymas nepakeistų gyvų Quickwit užklausų.
// BASELINE užfiksuotas iš originalios (pre-refactor) implementacijos; teksto dalis
// atnaujinta, kai naudotojo tekstas pradėtas paduoti kabutėse (issue #76:
// `(sutartis)` → `("sutartis")`) ir dar kartą, kai prie bazinės sąlygos prisidėjo
// pavadinimo boost'as (`("sutartis")` → `(("sutartis") OR title:("sutartis")^6)`).
const RICH = {
  q: 'sutartis',
  klase: 'a,b',
  type: 'teisesAktas,failas',
  host: 'example.com,foo.lt',
  jar: '123,456,xx',
  istaiga: '111,222',
  ext: '.PDF,doc',
  author: ['Jonas', 'Petras'],
  creator: 'Word',
  producer: ['Acrobat'],
  lang: 'lt,en',
  sav: 'Vilnius,Kaunas',
  apskritis: 'Vilniaus',
  source: 'cvpis,mvpAprasai',
  metai: '2020,2021,bad',
  teismas: ['LAT', 'LApT'],
  bylosRusis: ['civilinė, byla'],
  kategorija: ['k1', 'k2'],
  teisejas: ['T. Vardas'],
  aktoRusis: ['įsakymas'],
  galiojimas: ['galioja'],
  redakcija: ['aktuali'],
  projektoBusena: ['pateiktas'],
  eurovoc: ['terminas'],
  minLat: '54.1', maxLat: '55.2', minLon: '23.4', maxLon: '25.6',
  mode: 'words',
};
const PHRASE = { ...RICH, q: 'labas rytas class:c1 type:failas host:x.lt jar:999 ext:txt', mode: 'phrase' };
const EXCLUDE_KEYS = [
  'excludeClass', 'excludeType', 'excludeHost', 'excludeJar', 'excludeIstaiga', 'excludeExt',
  'excludeAuthor', 'excludeCreator', 'excludeProducer', 'excludeLang', 'excludeSav',
  'excludeApskritis', 'excludeSource', 'excludeMetai', 'excludeCourt', 'excludeCaseType',
  'excludeCategory', 'excludeJudge', 'excludeActType', 'excludeValidity', 'excludeEditionType',
  'excludeProjectStatus', 'excludeEurovoc',
] as const;

const BASELINE = {
  "parsed": {
    "textQuery": "sutartis",
    "classes": [
      "a",
      "b"
    ],
    "types": [
      "teisesAktas",
      "failas"
    ],
    "hosts": [
      "example.com",
      "foo.lt"
    ],
    "jars": [
      "123",
      "456",
      "xx"
    ],
    "istaigos": [
      "111",
      "222"
    ],
    "exts": [
      "pdf",
      "doc"
    ],
    "authors": [
      "Jonas",
      "Petras"
    ],
    "creators": [
      "Word"
    ],
    "producers": [
      "Acrobat"
    ],
    "langs": [
      "lt",
      "en"
    ],
    "savs": [
      "Vilnius",
      "Kaunas"
    ],
    "apskritys": [
      "Vilniaus"
    ],
    "sources": [
      "cvpIs",
      "mvpAprasai"
    ],
    "years": [
      "2020",
      "2021",
      "bad"
    ],
    "courts": [
      "LAT",
      "LApT"
    ],
    "caseTypes": [
      "civilinė, byla"
    ],
    "categories": [
      "k1",
      "k2"
    ],
    "judges": [
      "T. Vardas"
    ],
    "actTypes": [
      "įsakymas"
    ],
    "validities": [
      "galioja"
    ],
    "editionTypes": [
      "aktuali"
    ],
    "projectStatuses": [
      "pateiktas"
    ],
    "eurovoc": [
      "terminas"
    ],
    "bbox": {
      "minLat": 54.1,
      "maxLat": 55.2,
      "minLon": 23.4,
      "maxLon": 25.6
    },
    "phrase": false
  },
  "parsedPhrase": {
    "textQuery": "labas rytas",
    "classes": [
      "c1",
      "a",
      "b"
    ],
    "types": [
      "failas",
      "teisesAktas"
    ],
    "hosts": [
      "x.lt",
      "example.com",
      "foo.lt"
    ],
    "jars": [
      "999",
      "123",
      "456",
      "xx"
    ],
    "istaigos": [
      "111",
      "222"
    ],
    "exts": [
      "txt",
      "pdf",
      "doc"
    ],
    "authors": [
      "Jonas",
      "Petras"
    ],
    "creators": [
      "Word"
    ],
    "producers": [
      "Acrobat"
    ],
    "langs": [
      "lt",
      "en"
    ],
    "savs": [
      "Vilnius",
      "Kaunas"
    ],
    "apskritys": [
      "Vilniaus"
    ],
    "sources": [
      "cvpIs",
      "mvpAprasai"
    ],
    "years": [
      "2020",
      "2021",
      "bad"
    ],
    "courts": [
      "LAT",
      "LApT"
    ],
    "caseTypes": [
      "civilinė, byla"
    ],
    "categories": [
      "k1",
      "k2"
    ],
    "judges": [
      "T. Vardas"
    ],
    "actTypes": [
      "įsakymas"
    ],
    "validities": [
      "galioja"
    ],
    "editionTypes": [
      "aktuali"
    ],
    "projectStatuses": [
      "pateiktas"
    ],
    "eurovoc": [
      "terminas"
    ],
    "bbox": {
      "minLat": 54.1,
      "maxLat": 55.2,
      "minLon": 23.4,
      "maxLon": 25.6
    },
    "phrase": true
  },
  "base": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "phraseBase": "(class:\"c1\" OR class:\"a\" OR class:\"b\") AND (type:failas OR type:teisesAktas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"x.lt\" OR host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:999 OR jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"txt\" OR extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"labas rytas\") OR title:(\"labas rytas\")^6)",
  "ex_excludeClass": "(type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeType": "(class:\"a\" OR class:\"b\") AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeHost": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeJar": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeIstaiga": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeExt": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeAuthor": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeCreator": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeProducer": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeLang": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeSav": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeApskritis": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeSource": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeMetai": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeCourt": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeCaseType": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeCategory": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeJudge": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeActType": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeValidity": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeEditionType": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeProjectStatus": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)",
  "ex_excludeEurovoc": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND ((\"sutartis\") OR title:(\"sutartis\")^6)"
} as any;

describe('buildParts characterization (query-string stability)', () => {
  it('produces identical parsed structures and query strings', () => {
    const parsed = buildPartsOpts(RICH);
    const parsedPhrase = buildPartsOpts(PHRASE);
    const withoutETarFacets = ({ adoptedBy: _a, contentStates: _c, institutionNumbers: _i, registrationNumbers: _r, dateFrom: _f, dateTo: _t, ...rest }: any) => rest;
    const out: Record<string, unknown> = {
      parsed: withoutETarFacets(parsed),
      parsedPhrase: withoutETarFacets(parsedPhrase),
      base: buildPartsExcluding(parsed as any),
      phraseBase: buildPartsExcluding(parsedPhrase as any),
    };
    for (const k of EXCLUDE_KEYS) {
      out['ex_' + k] = buildPartsExcluding({ ...(parsed as any), [k]: true });
    }
    expect(out).toEqual(BASELINE);
  });

  it('filtruoja dinaminius e-TAR metadata laukus tikslia reikšme', () => {
    const parsed = buildPartsOpts({
      prieme: ['Lietuvos Respublikos Seimas'],
      turinys: ['provided'],
      istaigosNr: ['XIV-123'],
      regNr: ['2026-001'],
    });
    expect(buildPartsExcluding(parsed)).toBe(
      '(metadata.prieme:"Lietuvos Respublikos Seimas") AND ' +
      '(metadata.turinioBusena:"provided") AND ' +
      '(metadata.istaigosNr:"XIV-123") AND ' +
      '(metadata.registracijosNr:"2026-001")',
    );
    expect(buildPartsExcluding({ ...parsed, excludeInstitutionNumber: true })).not.toContain('metadata.istaigosNr');
  });

  it('dokumento datos intervalo pabaigą traktuoja imtinai', () => {
    const parsed = buildPartsOpts({ nuo: '2026-01-02', iki: '2026-01-31' });
    expect(buildPartsExcluding(parsed)).toBe(
      'happenedAt:[2026-01-02T00:00:00Z TO 2026-02-01T00:00:00Z}',
    );
    expect(parsed.dateFrom).toBe('2026-01-02');
    expect(parsed.dateTo).toBe('2026-01-31');
  });

  it('pavadinimą sveria labiau už turinį, bazinės sąlygos nesiaurindamas', () => {
    const parsed = buildPartsOpts({ q: 'silumos tinklu' });
    // Bazinė sąlyga (be lauko prefikso → default_search_fields) lieka pirmas OR
    // narys, tad rezultatų rinkinys gali tik plėstis.
    expect(buildPartsExcluding(parsed)).toBe(
      '(("silumos" "tinklu") OR title:("silumos" "tinklu")^6)',
    );
  });

  it('be diakritikos nededa perteklinės žalios formos', () => {
    const parsed = buildPartsOpts({ q: 'sutartis' });
    const query = buildPartsExcluding(parsed);
    expect(query).toBe('(("sutartis") OR title:("sutartis")^6)');
    expect(query).not.toContain('author:');
  });

  it('su diakritika prideda nesulietuvintą pavadinimo ir autoriaus formą', () => {
    // `title`/`author` indeksuojami nesulietuvinti, o `text` — sulietuvintas,
    // tad reikia abiejų formų (žr. quickwitProcessIndexQueue.js buildDoc).
    const parsed = buildPartsOpts({ q: 'šilumos tinklų' });
    expect(buildPartsExcluding(parsed)).toBe(
      '(("silumos" "tinklu")' +
      ' OR title:("silumos" "tinklu")^6' +
      ' OR title:("šilumos" "tinklų")^6' +
      ' OR author:("šilumos" "tinklų"))',
    );
  });

  it('frazės režimu boost\'ina visą frazę', () => {
    const parsed = buildPartsOpts({ q: 'šilumos tinklų rekonstrukcija', mode: 'phrase' });
    expect(buildPartsExcluding(parsed)).toBe(
      '(("silumos tinklu rekonstrukcija")' +
      ' OR title:("silumos tinklu rekonstrukcija")^6' +
      ' OR title:("šilumos tinklų rekonstrukcija")^6' +
      ' OR author:("šilumos tinklų rekonstrukcija"))',
    );
  });

  it('tekstas lieka paskutinis AND narys po filtrų', () => {
    const parsed = buildPartsOpts({ q: 'šilumos', klase: 'teisekura' });
    expect(buildPartsExcluding(parsed)).toBe(
      '(class:"teisekura") AND (("silumos") OR title:("silumos")^6' +
      ' OR title:("šilumos")^6 OR author:("šilumos"))',
    );
  });
});
