/** Quickwit schema outbound scraping HTTP užklausų metaduomenims. */
export const SCRAPE_LOG_INDEX_CONFIG = `version: 0.9

index_id: scrapeLogV1Template

doc_mapping:
  mode: lenient
  store_source: false
  index_field_presence: false
  field_mappings:
    - { name: ts, type: datetime, input_formats: [rfc3339, unix_timestamp], output_format: rfc3339, fast_precision: milliseconds, indexed: true, fast: true, stored: true }
    - { name: requestId, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: env, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: role, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: scraper, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: operation, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: item, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: method, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: scheme, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: host, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: domain, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: path, type: text, tokenizer: default, indexed: true, stored: true }
    - { name: finalScheme, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: finalHost, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: finalDomain, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: finalPath, type: text, tokenizer: default, indexed: true, stored: true }
    - { name: status, type: i64, indexed: true, fast: true, stored: true }
    - { name: ok, type: bool, indexed: true, fast: true, stored: true }
    - { name: redirected, type: bool, indexed: true, fast: true, stored: true }
    - { name: cancelled, type: bool, indexed: true, fast: true, stored: true }
    - { name: ttfbMs, type: f64, indexed: true, fast: true, stored: true }
    - { name: ms, type: f64, indexed: true, fast: true, stored: true }
    - { name: bytes, type: i64, indexed: true, fast: true, stored: true }
    - { name: contentLength, type: i64, indexed: true, fast: true, stored: true }
    - { name: errorName, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
    - { name: errorCode, type: text, tokenizer: raw, indexed: true, fast: true, stored: true }
  tag_fields: [env, role, scraper, operation, method, scheme, host, domain]
  timestamp_field: ts

search_settings:
  default_search_fields: [scraper, operation, host, domain, path, item]

indexing_settings:
  commit_timeout_secs: 30
`;
