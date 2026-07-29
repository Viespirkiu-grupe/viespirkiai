import { describe, expect, it } from 'vitest';
import { buildPartsExcluding, buildPartsOpts } from '@/src/lib/searchDokumentai.ts';

// Charakterizacinis testas: fiksuoja TIKSLIAS buildPartsOpts/buildPartsExcluding
// išvestis, kad FACETS deskriptoriaus perrašymas nepakeistų gyvų Quickwit užklausų.
// BASELINE užfiksuotas iš originalios (pre-refactor) implementacijos; teksto dalis
// atnaujinta, kai naudotojo tekstas pradėtas paduoti kabutėse (issue #76:
// `(sutartis)` → `("sutartis")`).
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
  "base": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "phraseBase": "(class:\"c1\" OR class:\"a\" OR class:\"b\") AND (type:failas OR type:teisesAktas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"x.lt\" OR host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:999 OR jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"txt\" OR extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND \"labas rytas\"",
  "ex_excludeClass": "(type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeType": "(class:\"a\" OR class:\"b\") AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeHost": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeJar": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeIstaiga": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeExt": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeAuthor": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeCreator": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeProducer": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeLang": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeSav": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeApskritis": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeSource": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeMetai": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeCourt": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeCaseType": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeCategory": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeJudge": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeActType": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeValidity": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeEditionType": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.busena:\"pateiktas\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeProjectStatus": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.eurovocTerminai:\"terminas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")",
  "ex_excludeEurovoc": "(class:\"a\" OR class:\"b\") AND (type:teisesAktas OR type:failas) AND (metadata.teismas:\"LAT\" OR metadata.teismas:\"LApT\") AND (metadata.bylosRusis:\"civilinė, byla\") AND (metadata.kategorijos:\"k1\" OR metadata.kategorijos:\"k2\") AND (metadata.teisejai:\"T. Vardas\") AND (metadata.rusis:\"įsakymas\") AND (metadata.galiojimas:\"galioja\") AND (metadata.editionType:\"aktuali\") AND (metadata.busena:\"pateiktas\") AND (host:\"example.com\" OR host:\"foo.lt\") AND (jarKodai:123 OR jarKodai:456) AND (istaigaJar:\"111\" OR istaigaJar:\"222\") AND (extension:\"pdf\" OR extension:\"doc\") AND (author:\"Jonas\" OR author:\"Petras\") AND (metadata.creator:\"Word\") AND (metadata.producer:\"Acrobat\") AND (language:\"lt\" OR language:\"en\") AND (savivaldybe:\"Vilnius\" OR savivaldybe:\"Kaunas\") AND (apskritis:\"Vilniaus\") AND (source:\"cvpIs\" OR source:\"mvpAprasai\") AND (happenedAt:[2020-01-01T00:00:00Z TO 2021-01-01T00:00:00Z} OR happenedAt:[2021-01-01T00:00:00Z TO 2022-01-01T00:00:00Z}) AND lat:[54.1 TO 55.2] AND lon:[23.4 TO 25.6] AND (\"sutartis\")"
} as any;

describe('buildParts characterization (query-string stability)', () => {
  it('produces identical parsed structures and query strings', () => {
    const parsed = buildPartsOpts(RICH);
    const parsedPhrase = buildPartsOpts(PHRASE);
    const out: Record<string, unknown> = {
      parsed,
      parsedPhrase,
      base: buildPartsExcluding(parsed as any),
      phraseBase: buildPartsExcluding(parsedPhrase as any),
    };
    for (const k of EXCLUDE_KEYS) {
      out['ex_' + k] = buildPartsExcluding({ ...(parsed as any), [k]: true });
    }
    expect(out).toEqual(BASELINE);
  });
});
