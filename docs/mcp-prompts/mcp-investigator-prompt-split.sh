#!/usr/bin/env bash
# Splits mcp-investigator-prompt.md into:
#   mcp-investigator-prompt-thin.md  — no SQL blocks, no "> For human investigator:" blocks
#   mcp-investigator-prompt-sql.md   — only # headers + SQL blocks

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/mcp-investigator-prompt.md"
THIN="$DIR/mcp-investigator-prompt-thin.md"
SQLF="$DIR/mcp-investigator-prompt-sql.md"

> "$THIN"
> "$SQLF"

in_sql=0
in_human=0

while IFS= read -r line; do

  # --- detect block boundaries ---

  if [[ "$line" == '```sql' ]]; then
    in_sql=1
    # sql file: copy the opening fence
    echo "$line" >> "$SQLF"
    continue
  fi

  if [[ $in_sql -eq 1 && "$line" == '```' ]]; then
    in_sql=0
    # sql file: copy the closing fence
    echo "$line" >> "$SQLF"
    continue
  fi

  if [[ $in_human -eq 0 && "$line" == '> For human investigator:'* ]]; then
    in_human=1
    continue
  fi

  # still inside a human block while line starts with >
  if [[ $in_human -eq 1 ]]; then
    if [[ "$line" == '>'* ]]; then
      continue   # skip
    else
      in_human=0  # block ended, fall through to normal processing
    fi
  fi

  # --- write to files ---

  if [[ $in_sql -eq 1 ]]; then
    echo "$line" >> "$SQLF"
  else
    # thin file: normal lines (not inside sql, not inside human block)
    [[ "$line" == 'SQL EXAMPLES:' ]] && continue
    echo "$line" >> "$THIN"

    # sql file: copy # headers
    if [[ "$line" == '#'* ]]; then
      echo "$line" >> "$SQLF"
    fi
  fi

done < "$SRC"

echo "Done."
echo "  thin: $THIN"
echo "  sql:  $SQLF"
