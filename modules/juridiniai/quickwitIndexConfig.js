/**
 * Quickwit schema juridinių asmenų indeksams.
 *
 * Schema laikoma JS modulyje, o ne atskirame YAML faile, nes šis kodas veikia
 * ir tiesiogiai per Node, ir iš sukompiliuoto runtime bundle'io. Atskiras failas
 * į bundle'į automatiškai nepatenka.
 *
 * `index_id` yra tik šablonas. `quickwit/quickwit.js`, kurdamas naują shard'ą,
 * jį pakeičia į `juridiniai_N`.
 */
export const JURIDINIAI_QUICKWIT_INDEX_CONFIG = `version: 0.9

index_id: juridiniaiTemplate

doc_mapping:
  mode: strict
  store_source: false
  index_field_presence: false
  field_mappings:
    - { name: quickwitId, type: text, tokenizer: raw, record: basic, fieldnorms: false, indexed: true, fast: { normalizer: raw }, stored: true }
    - { name: jarKodas, type: text, tokenizer: raw, record: basic, fieldnorms: false, indexed: true, fast: { normalizer: raw }, stored: true }
    - { name: pavadinimas, type: text, tokenizer: default, record: position, fieldnorms: true, indexed: true, fast: false, stored: true }
    - { name: pavadinimasAscii, type: text, tokenizer: default, record: position, fieldnorms: false, indexed: true, fast: false, stored: false }
    - { name: adresas, type: text, tokenizer: default, record: position, fieldnorms: false, indexed: true, fast: false, stored: true }
    - { name: formosKodas, type: i64, coerce: true, indexed: true, fast: true, stored: true }
    - { name: formosPavadinimas, type: text, tokenizer: raw, record: basic, fieldnorms: false, indexed: true, fast: { normalizer: raw }, stored: true }
    - { name: viesasis, type: bool, indexed: true, fast: true, stored: true }
    - { name: statusoKodas, type: i64, coerce: true, indexed: true, fast: true, stored: true }
    - { name: statusoPavadinimas, type: text, tokenizer: raw, record: basic, fieldnorms: false, indexed: true, fast: { normalizer: raw }, stored: true }
    - { name: isregistruotas, type: bool, indexed: true, fast: true, stored: true }
    - { name: registravimoData, type: datetime, input_formats: [rfc3339], output_format: unix_timestamp_secs, fast_precision: seconds, indexed: true, fast: true, stored: true }
    - { name: isregistravimoData, type: datetime, input_formats: [rfc3339], output_format: unix_timestamp_secs, fast_precision: seconds, indexed: true, fast: true, stored: true }
    - { name: savivaldybe, type: text, tokenizer: raw, record: basic, fieldnorms: false, indexed: true, fast: { normalizer: raw }, stored: true }
    - { name: apskritis, type: text, tokenizer: raw, record: basic, fieldnorms: false, indexed: true, fast: { normalizer: raw }, stored: true }
    - { name: evrkKodas, type: text, tokenizer: raw, record: basic, fieldnorms: false, indexed: true, fast: { normalizer: raw }, stored: true }
    - { name: evrkPavadinimas, type: text, tokenizer: default, record: position, fieldnorms: false, indexed: true, fast: false, stored: true }
    - { name: darbuotojai, type: u64, coerce: true, indexed: true, fast: true, stored: true }
    - { name: vidutinisAtlyginimas, type: f64, coerce: true, indexed: true, fast: true, stored: true }
    - { name: rodikliai, type: json, tokenizer: raw, record: basic, expand_dots: false, indexed: true, fast: { normalizer: raw }, stored: true }
    - { name: geo, type: json, tokenizer: raw, record: basic, expand_dots: false, indexed: true, fast: { normalizer: raw }, stored: true }
    - { name: atnaujinta, type: datetime, input_formats: [rfc3339], output_format: unix_timestamp_secs, fast_precision: seconds, indexed: true, fast: true, stored: true }
    - name: paieska
      type: concatenate
      concatenate_fields:
        - jarKodas
        - pavadinimas
        - pavadinimasAscii
        - adresas
        - formosPavadinimas
        - statusoPavadinimas
        - evrkKodas
        - evrkPavadinimas
      include_dynamic_fields: false
      tokenizer: default
      record: position
  timestamp_field: atnaujinta
  tag_fields: [apskritis, formosKodas, statusoKodas]

indexing_settings:
  commit_timeout_secs: 15

search_settings:
  default_search_fields: []
`;
