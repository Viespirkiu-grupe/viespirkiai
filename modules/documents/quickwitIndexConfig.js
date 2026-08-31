/**
 * Quickwit schema dokumentų indeksams.
 *
 * Schema laikoma JS modulyje, o ne tik DB, nes šis kodas veikia ir tiesiogiai
 * per Node, ir iš sukompiliuoto runtime bundle'io. `quickwit.lenteles` eilutę
 * atnaujina pats indeksavimo darbas (žr. ensureDocumentsQuickwitConfig).
 *
 * `index_id` yra tik šablonas. `quickwit/quickwit.js`, kurdamas naują shard'ą,
 * jį pakeičia į `documents_N`.
 *
 * Skirtumai nuo senosios `dokumentai` schemos:
 *   + geo (json) — Morton raktai z0..z19; be jų šiluminis žemėlapis negalėjo
 *     būti sudarytas agregacija ir buvo skaičiuojamas atskiroje DB lentelėje;
 *   + titleAscii, authorAscii — sulietuvinti variantai. Anksčiau `title` ir
 *     `author` buvo indeksuojami su diakritika, o `text` — be jos, tad ta pati
 *     užklausa negalėjo pasiekti abiejų ir kodas siuntė po dvi sąlygas;
 *   + fileId — leidžia atskirti failais paremtus dokumentus neinant į PG;
 *   ~ saltinioId0..3 → sourceId0..3 — vardai suvienodinti su DB;
 *   ~ index_field_presence: false — egzistavimo užklausų (`laukas:*`) niekur
 *     nenaudojam, o jos kainuoja indekso vietą;
 *   − version — sidecar formato versija, kurios niekas neskaitė. Sidecar JSON
 *     ją laiko toliau, tik į indeksą nebekeliauja.
 *
 * savivaldybe ir apskritis PALIEKAMI, nors DB jų nebeturi ir jie visada tušti:
 * jais tebesiremia paieškos fasetės (src/lib/dokumentai/search/facets.ts) ir
 * sąsaja. Išimti juos galima tik kartu su ta fasete – tai atskiras UI darbas.
 */
export const DOCUMENTS_QUICKWIT_INDEX_CONFIG = `version: 0.9

index_id: documentsTemplate

doc_mapping:
  mode: lenient
  index_field_presence: false
  store_source: false

  field_mappings:

    # --- Tapatybė ---
    - { name: id, type: i64, indexed: true, fast: true, stored: true }
    - { name: quickwitId, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: md5, type: text, tokenizer: raw, indexed: true, stored: true }
    - { name: class, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: type, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: parent, type: i64, indexed: true, fast: true, stored: true }
    - { name: fileId, type: i64, indexed: true, fast: true, stored: true }

    # --- Šaltinis ir adresas ---
    - { name: host, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: domain, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: url, type: text, tokenizer: raw, indexed: true, fast: false, stored: true }
    - { name: source, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: istaigaJar, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }

    - { name: sourceId0, type: text, tokenizer: raw, indexed: true, stored: true }
    - { name: sourceId1, type: text, tokenizer: raw, indexed: true, stored: true }
    - { name: sourceId2, type: text, tokenizer: raw, indexed: true, stored: true }
    - { name: sourceId3, type: text, tokenizer: raw, indexed: true, stored: true }

    # --- Susiję subjektai (iš sidecar) ---
    - { name: jarKodai, type: array<i64>, indexed: true, fast: true, stored: true }
    - { name: phones, type: array<text>, tokenizer: raw, indexed: true, stored: true }
    - { name: emails, type: array<text>, tokenizer: raw, indexed: true, stored: true }
    - { name: iban, type: array<text>, tokenizer: raw, indexed: true, stored: true }
    - { name: domains, type: array<text>, tokenizer: raw, indexed: true, stored: true }

    # --- Pavadinimas ir autorius ---
    # Rodymui ir tiksliai atitikčiai laikom originalą, paieškai — sulietuvintą.
    # Ascii variantai nesaugomi: jie tik ieškomi, o rodomas originalas.
    - { name: title, type: text, tokenizer: default, record: position, fieldnorms: true, indexed: true, fast: false, stored: true }
    - { name: titleAscii, type: text, tokenizer: default, record: position, fieldnorms: true, indexed: true, fast: false, stored: false }
    - { name: author, type: text, tokenizer: default, record: position, fieldnorms: false, indexed: true, fast: true, stored: true }
    - { name: authorAscii, type: text, tokenizer: default, record: position, fieldnorms: false, indexed: true, fast: false, stored: false }

    # --- Failo metaduomenys ---
    - { name: extension, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: mimeType, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: metadata, type: json, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: language, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: pageCount, type: i64, indexed: false, fast: true, stored: true }
    - { name: wordCount, type: i64, indexed: false, fast: true, stored: true }
    - { name: characterCount, type: i64, indexed: false, fast: true, stored: true }

    # --- Turinys ---
    # Indeksuojamas sulietuvintas; originalas didelis ir imamas iš sidecar failo.
    - { name: text, type: text, tokenizer: default, record: position, fieldnorms: true, indexed: true, fast: false, stored: false }

    # --- Geografija ---
    # Visada tušti; laukia, kol bus pašalinta atitinkama paieškos fasetė.
    - { name: savivaldybe, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: apskritis, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }

    # geo.lat / geo.lon — rėmelio filtrui, geo.zN — Morton raktai žemėlapio
    # langeliams per terms agregaciją (žr. quickwit/morton.js).
    - { name: geo, type: json, tokenizer: raw, record: basic, expand_dots: false, indexed: true, fast: true, stored: true }

    # --- Laikai ---
    - { name: discoveredAt, type: datetime, input_formats: [rfc3339, unix_timestamp], output_format: unix_timestamp_secs, fast_precision: seconds, indexed: true, fast: true, stored: true }
    - { name: createdAt, type: datetime, input_formats: [rfc3339, unix_timestamp], output_format: unix_timestamp_secs, fast_precision: seconds, indexed: true, fast: true, stored: true }
    - { name: updatedAt, type: datetime, input_formats: [rfc3339, unix_timestamp], output_format: unix_timestamp_secs, fast_precision: seconds, indexed: true, fast: true, stored: true }
    - { name: happenedAt, type: datetime, input_formats: [rfc3339, unix_timestamp], output_format: unix_timestamp_secs, fast_precision: seconds, indexed: true, fast: true, stored: true }

  timestamp_field: updatedAt
  tag_fields: [class, source]

search_settings:
  default_search_fields: [text, titleAscii, authorAscii]

indexing_settings:
  commit_timeout_secs: 15
`;
