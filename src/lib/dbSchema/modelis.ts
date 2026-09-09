import * as uzklausos from './uzklausos.ts';
import { gautiMeta } from './meta.ts';
import { NUMATYTOJI_TVARKA } from './schemos.ts';
import type {
  Indeksas, Lentele, LentelesRaktas, Metrikos, Ribojimas,
  Rysys, Schema, SchemosModelis, Stulpelis, Trigeris,
} from './tipai.ts';

/**
 * Visos bazės schemos modelis su TTL kešu.
 *
 * Puslapis viešas, o katalogo užklausos liečia ~500 lentelių, tad krova daroma
 * kartą ir dalinama visiems: `createTtlPromiseCache` ne tik kešuoja, bet ir
 * sujungia lygiagrečius krovimus – 50 vienu metu užėjusių lankytojų duoda
 * vieną DB krovą, ne 50.
 *
 * Krova kainuoja ~150 ms, tad ilgo TTL nereikia: 2 min. reiškia ~0,1 % apkrovos
 * ir kelis kartus mažesnį pasenimą pritaikius SQL. Išimtis – kai `dba`
 * metaduomenų nusiskaityti nepavyko: tokį atsakymą laikom trumpai, kad ką tik
 * pritaikius `dbaSchema.sql` puslapis atsigautų per pusę minutės, o ne po 10.
 *
 * Dėl skirtingų TTL naudojam savą įrašą, o ne `utils/ttlPromiseCache.js`, kurio
 * TTL fiksuotas. Lygiagretūs krovimai vis tiek sujungiami: kol `promise` dar
 * neišsisprendęs, visi gauna tą patį.
 */
const KESO_TTL = 2 * 60_000;
const KLAIDOS_TTL = 30_000;

let irasas: { promise: Promise<SchemosModelis>; galiojaIki: number } | null = null;

export function gautiSchemosModeli(): Promise<SchemosModelis> {
  if (irasas && irasas.galiojaIki > Date.now()) return irasas.promise;

  const savas = {
    // Kol kraunasi, galioja – kad lygiagrečios užklausos nepaleistų antros krovos.
    galiojaIki: Number.POSITIVE_INFINITY,
    promise: null as unknown as Promise<SchemosModelis>,
  };

  savas.promise = kraunamaSchema().then(
    (modelis) => {
      savas.galiojaIki = Date.now() + (modelis.metaKlaida ? KLAIDOS_TTL : KESO_TTL);
      return modelis;
    },
    (klaida) => {
      // Nepavykusios krovos nekešuojam – kitas užklausėjas bando iš naujo.
      if (irasas === savas) irasas = null;
      throw klaida;
    },
  );

  irasas = savas;
  return savas.promise;
}

function raktas(schema: string, vardas: string): LentelesRaktas {
  return `${schema}.${vardas}`;
}

/** Sugrupuoja eilutes pagal `schema.lentele`. */
function pagalLentele<T extends { schema: string; lentele: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = raktas(row.schema, row.lentele);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

async function kraunamaSchema(): Promise<SchemosModelis> {
  const [schemosRows, lentelesRows, stulpeliaiRows, ribojimaiRows, indeksaiRows, trigeriaiRows, dydziaiRows, meta] =
    await Promise.all([
      uzklausos.schemos(),
      uzklausos.lenteles(),
      uzklausos.stulpeliai(),
      uzklausos.ribojimai(),
      uzklausos.indeksai(),
      uzklausos.trigeriai(),
      uzklausos.dydziai(),
      gautiMeta(),
    ]);

  const stulpeliaiPagal = pagalLentele(stulpeliaiRows);
  const ribojimaiPagal = pagalLentele(ribojimaiRows);
  const indeksaiPagal = pagalLentele(indeksaiRows);
  const trigeriaiPagal = pagalLentele(trigeriaiRows);

  const dydziai = new Map<string, any>();
  for (const row of dydziaiRows) dydziai.set(raktas(row.schemaName, row.tableName), row);

  // `COMMENT ON SCHEMA "x" IS ''` yra tuščias, o ne nesamas aprašymas – rodyti
  // tokį reikštų tuščią eilutę po antrašte.
  const schemuAprasymai = new Map<string, string | null>(
    schemosRows.map((row: any) => [row.vardas, row.aprasymas?.trim() || null]),
  );

  const rysiai: Rysys[] = [];
  const lenteles: Lentele[] = [];

  for (const row of lentelesRows) {
    const key = raktas(row.schema, row.vardas);
    const lentelesMeta = meta.lenteles.get(key) ?? null;

    const ribojimai = (ribojimaiPagal.get(key) ?? []).map((r: any): Ribojimas => ({
      vardas: r.vardas,
      tipas: r.tipas,
      apibrezimas: r.apibrezimas,
      rodoI: r.isorineLentele ? raktas(r.isorineSchema, r.isorineLentele) : null,
      stulpeliai: r.stulpeliai ?? [],
      isoriniaiStulpeliai: r.isoriniaiStulpeliai ?? [],
    }));

    const pirminiai = new Set(
      ribojimai.filter((r) => r.tipas === 'p').flatMap((r) => r.stulpeliai),
    );
    const fkPagalStulpeli = new Map<string, LentelesRaktas>();
    for (const r of ribojimai) {
      if (r.tipas !== 'f' || !r.rodoI) continue;
      for (const stulpelis of r.stulpeliai) fkPagalStulpeli.set(stulpelis, r.rodoI);
      rysiai.push({
        is: key,
        i: r.rodoI,
        vardas: r.vardas,
        stulpeliai: r.stulpeliai,
        isoriniaiStulpeliai: r.isoriniaiStulpeliai,
      });
    }

    const stulpeliai = (stulpeliaiPagal.get(key) ?? []).map((c: any): Stulpelis => ({
      vardas: c.vardas,
      tipas: c.tipas,
      arButinas: c.arButinas,
      numatytoji: c.numatytoji ?? null,
      generuota: c.generuota === 's',
      aprasymas: c.aprasymas ?? null,
      arPirminis: pirminiai.has(c.vardas),
      isorinisRaktas: fkPagalStulpeli.get(c.vardas) ?? null,
    }));

    const indeksai = (indeksaiPagal.get(key) ?? []).map((i: any): Indeksas => ({
      vardas: i.vardas,
      apibrezimas: i.apibrezimas,
      arPirminis: i.arPirminis,
      dydis: Number(i.dydis ?? 0),
    }));

    const trigeriai = (trigeriaiPagal.get(key) ?? []).map((t: any): Trigeris => ({
      vardas: t.vardas,
      apibrezimas: t.apibrezimas,
    }));

    const dydis = dydziai.get(key);

    lenteles.push({
      raktas: key,
      schema: row.schema,
      vardas: row.vardas,
      aprasymas: row.aprasymas ?? null,
      stulpeliai,
      ribojimai,
      indeksai,
      trigeriai,
      duomenuDydis: Number(dydis?.dataSize ?? 0),
      indeksuDydis: Number(dydis?.indexSize ?? 0),
      bendrasDydis: Number(dydis?.totalSize ?? 0),
      eiluciuIvertis: Number(dydis?.approxRowCount ?? Math.max(0, Number(row.eiluciuIvertis) || 0)),
      meta: lentelesMeta,
    });
  }

  const pagalRakta = new Map(lenteles.map((l) => [l.raktas, l]));

  // Rodomos tik tos schemos, kuriose realiai yra lentelių. `dba."schemos"`
  // įrašas neprivalomas: be jo schema vadinasi savo vardu ir stoja į galą.
  const schemos = [...new Set(lenteles.map((l) => l.schema))]
    .map((vardas): Schema => {
      const schemosMeta = meta.schemos.get(vardas);
      return {
        vardas,
        pavadinimas: schemosMeta?.pavadinimas ?? vardas,
        aprasymas: schemuAprasymai.get(vardas) ?? null,
        saltinis: schemosMeta?.saltinis ?? null,
        saltinioUrl: schemosMeta?.saltinioUrl ?? null,
        tvarka: schemosMeta?.tvarka ?? NUMATYTOJI_TVARKA,
      };
    })
    .sort((a, b) => a.tvarka - b.tvarka || a.pavadinimas.localeCompare(b.pavadinimas, 'lt'));

  return {
    lenteles,
    pagalRakta,
    schemos,
    schemosPagalVarda: new Map(schemos.map((s) => [s.vardas, s])),
    rysiai,
    metrikos: suskaiciuotiMetrikas(lenteles, rysiai, schemos.length),
    sudaryta: new Date().toISOString(),
    metaKlaida: meta.klaida,
  };
}

function suskaiciuotiMetrikas(lenteles: Lentele[], rysiai: Rysys[], schemu: number): Metrikos {
  let stulpeliu = 0;
  let aprasytaStulpeliu = 0;
  let aprasytaLenteliu = 0;
  let bendrasDydis = 0;
  let eiluciuIvertis = 0;

  for (const lentele of lenteles) {
    stulpeliu += lentele.stulpeliai.length;
    aprasytaStulpeliu += lentele.stulpeliai.filter((s) => s.aprasymas).length;
    if (lentele.aprasymas) aprasytaLenteliu += 1;
    bendrasDydis += lentele.bendrasDydis;
    eiluciuIvertis += lentele.eiluciuIvertis;
  }

  return {
    lenteliu: lenteles.length,
    stulpeliu,
    isoriniuRaktu: rysiai.length,
    bendrasDydis,
    eiluciuIvertis,
    aprasytaLenteliu,
    aprasytaStulpeliu,
    schemu,
  };
}

/** Vienos schemos lentelės, didžiausios pirma. */
export function schemosLenteles(modelis: SchemosModelis, schema: string): Lentele[] {
  return modelis.lenteles
    .filter((l) => l.schema === schema)
    .sort((a, b) => b.bendrasDydis - a.bendrasDydis || a.vardas.localeCompare(b.vardas, 'lt'));
}

/**
 * Lentelė pagal `schema.vardas` arba pagal vien vardą.
 *
 * Bevardė paieška tinka tik tada, kai vardas visoje bazėje vienintelis: apie 25
 * vardai kartojasi keliose schemose (`sutartys` yra ir `sabis`, ir
 * `vpmSutartys`), o spėti už lankytoją būtų blogiau nei nurodyti, kad reikia
 * pilno vardo. Naudojama tik `/duomenys/lenteles/l/<vardas>` nuorodoms.
 */
export function rasti(modelis: SchemosModelis, segmentas: string): Lentele | null {
  const tikslus = modelis.pagalRakta.get(segmentas);
  if (tikslus) return tikslus;

  const pagalVarda = modelis.lenteles.filter((l) => l.vardas === segmentas);
  return pagalVarda.length === 1 ? pagalVarda[0] : null;
}

/**
 * FK kaimynystė: pati lentelė ir viskas, kas su ja susiję išoriniais raktais
 * abiem kryptimis, iki nurodyto gylio.
 */
export function kaimynyste(
  modelis: SchemosModelis,
  pradzia: LentelesRaktas,
  gylis = 1,
): { lenteles: Lentele[]; rysiai: Rysys[] } {
  const aplankyta = new Set<LentelesRaktas>([pradzia]);
  let sluoksnis = new Set<LentelesRaktas>([pradzia]);

  for (let i = 0; i < gylis; i += 1) {
    const kitas = new Set<LentelesRaktas>();
    for (const rysys of modelis.rysiai) {
      if (sluoksnis.has(rysys.is) && !aplankyta.has(rysys.i)) kitas.add(rysys.i);
      if (sluoksnis.has(rysys.i) && !aplankyta.has(rysys.is)) kitas.add(rysys.is);
    }
    for (const key of kitas) aplankyta.add(key);
    sluoksnis = kitas;
  }

  return {
    lenteles: [...aplankyta].map((k) => modelis.pagalRakta.get(k)).filter(Boolean) as Lentele[],
    rysiai: modelis.rysiai.filter((r) => aplankyta.has(r.is) && aplankyta.has(r.i)),
  };
}
