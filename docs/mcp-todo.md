# MCP TODO:

[R] Žemiau pateikti komentarai yra agento, kuris atsakė paklaustas kaip sekėsi - atleiskit jam jei kažką suvarė ar šneka
nekorektiškai :)

## (FIXED) 1. get_juridinis grąžina per daug duomenų.

Abiejų įmonių atsakymai buvo 150 000+ simbolių — viršijo kontekstą ir buvo išsaugoti į failus. Teko daryti grep
atskirai. Tai sulėtino tyrimą ir kelia riziką praleisti svarbią informaciją (pvz., bylos, VDI pažeidimai, blacklistai).

## (FIXED) 2.1 search_failai nerado nieko konkretaus.

Grąžino 20 dokumentų, bet nė vienas nebuvo tiesiogiai susijęs su Žemaitaičiu — paieška pagal vardą pilname tekste yra
triukšminga. Neaišku, ar dokumentuose jo vardas iš viso yra, ar tiesiog sutapo kiti raktažodžiai.

## (FIXED) 2.2 search_failai nerodo konteksto

Grąžino ~15 failų, tačiau nematyti, KUR dokumente atsiranda paieškos žodis. Teko spėlioti — ar tai tikras radinys, ar
nesusiję dokumentai. Be teksto ištraukos (~150 simbolių aplink atitikmenį) neaišku, ar verta siųsti get_failas_tekstas.

## 3.1 search_sutartys neturi suvestinių.

Kai ieškojau įmonių pagal tiekejoKodas, gavau sąrašą, bet nežinojau bendros sumos ar sutarčių kiekio iš karto — reikėjo
skaičiuoti rankiniu būdu arba kviesti execute_query (kurio šiam tyrimui nekviečiau).

## (FIXED) 3.2 search_sutartys neturi tikslios vardo paieškos

search="Žemaitaitis" grąžino 22 rezultatus su Agniumi, Viktoru, Gediminu, Eividu — visiškai nesusijusiais žmonėmis. Teko
rankiniu būdu filtruoti.

## (FIXED) 3.3 Fizinio asmens tiekėjo kodas = 809 negali būti naudojamas search_sutartys(tiekejoKodas=809)

Žemaitaitis kaip tiekėjas turi kodą 809 (fizinis asmuo), todėl search_sutartys(tiekejoKodas=809) grąžintų visus
fizinius asmenis — negalima filtruoti tik jo sutarčių pagal kodą. Teko ieškoti per search="Žemaitaitis" ir filtruoti
rankiniu būdu.

## (FIXED) 3.4 get_juridinis ir search_sutartys — atsakymų dydis

Abu įrankiai grąžino tiek duomenų, kad jie netelpo į pagrindinį kontekstą. Teko kurti subagentus, kurie skaitė failus po
200 eilučių — tai sudėtinga, lėta ir neefektyvu. Visas tyrimas dėl to truko ~2x ilgiau.

## 4. get_pinreg_asmuo grąžina duplikatus

Žemaitaičiui grąžino 2 deklaracijas (skirtingos datos) su iš esmės tais pačiais duomenimis. Reikėjo perskaityti abu, kad
įsitikintum, jog naujiena — tik versija.

## (FIXED) 5. v_sutartys ne iki galo dirba su kodais

v_sutartys — fiziniai asmenys neturėtų būti null tiekejas laukas turėtų rodyti vardą net kai tiekejoKodas = '809'. Jei
privatumo sumetimais tai neįmanoma, bent jau leisti filtruoti WHERE tiekejas ILIKE '%Žemaitaitis%' pačiame SQL.

## (MITIGATED) 6. v_dalyviai — InnoForce visai nebuvo

Pradėjau tikrinti konkurencingumą (kiek dalyvių InnoForce tenderuose), bet v_dalyviai grąžino 0 eilučių. Matyt ATN1
sistema neapima visų pirkimų arba InnoForce pirkimų duomenų ten nėra. Tai sukūrė aklavietę — negalėjau patikrinti vieno
svarbiausių rizikos rodiklių.

[RB] Reikia patestuoti kas čia įvyko, surinkti SQL logus.

## 7. get_bylos(jarKodas) su filtru bylojeKaip

Šiuo metu bylos grąžinamos per get_juridinis kaip didelio JSON dalis. Atskiras įrankis su filtru (IEŠKOVAS / ATSAKOVAS)
ir pirkimo konteksto ryšiu leistų greitai identifikuoti agresyvios litigacijos modelius.

[RB] Reikia pagalvoti apie MCP visiems subjektams atskirai, ne tik bylos, pvz get_rysiai, get_dalyviai ir t.t.

# Ne Funkciniai Pakeitimai

## 1. Įdiegit TRACE loginimą

Reikia TRACE loginimo kuris atspausdintų kiekvieno užklausimo metu vykdomą SQL užklausą ir jos parametrus. Tai ypač
palengvintų testavimą. TRACE būtų išjungtas visose testavimo aplinkose ir jį galima būtų įsijungti testuojant lokaliai.

## 2. Įdiegti testus

Būtini IT testai visiems MCP funkcionalumams, ypač tiems, kurie susiję su duomenų grąžinimu ir filtravimu.

## 3. TypeScript migracija

Visas MCP kodas turėtų būti perrašytas į TypeScript, kad būtų užtikrintas geresnis tipų tikrinimas ir sumažinta klaidų
tikimybė. Tai ypač palengvintų priežiūrą ateityje.

## 4. Centralizuoti MCP Aprašymus ir konfigūraciją

Visi MCP tools aprašymai turi būti iškelti į atskirą konfig failą su on/off flagais, pvz:

```json
{
  "get_juridinis": {
    "enabled": true,
    "publicMethodName": "get_company_info",
    "description": "Grąžina juridinio asmens informaciją pagal įmonės kodą.",
    "parameters": {
      "imonesKodas": "Įmonės kodas, pvz., '123456789'."
    }
  },
  "search_failai": {
    "enabled": false,
    "publicMethodName": "search_files",
    "description": "Ieško failų pagal raktažodį ir grąžina atitinkančius failus.",
    "parameters": {
      "search": "Raktažodis, pvz., 'Žemaitaitis'."
    }
  },
  ...
}
```

## 5. (POC) Ištestuoti MCP su anglų kalba

_LLMs use **English** as their **latent internal language** even when prompted in another language. Reasoning happens in
English internally — it's only in the final layers that the model translates the response into the prompt's language.
This has a direct architectural implication for your system._

Rekomendacija:

| Layer                                                      | What it does                                           | Best language                           | Why                                                                                                                                                                                   |
|------------------------------------------------------------|--------------------------------------------------------|-----------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Orchestrator prompt** (theme, template, task definition) | Reasoning, planning, fraud pattern recognition         | **English**                             | Complex reasoning is anchored in English internally; any other language adds translation overhead and increases error rate                                                            |
| **Subagent ↔ Lithuanian MCP docs**                         | Extracting facts from Lithuanian procurement documents | **Lithuanian prompt + Lithuanian docs** | A 2025 study across 35 languages found that matching prompt language to content language consistently outperforms the "translate everything to English" approach for extraction tasks |

Dėl šios priežasties rekomenduoju išsitestuoti su anglų kalba, pažiūrėti kas geriau gaunasi. Tą daryti reikia po to kai
ištaisysim klaidas ir iškelsime MCP konfigą.