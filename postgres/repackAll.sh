#!/bin/bash
set -e

SCHEMA=${1:-}

if [ -n "$SCHEMA" ]; then
    SCHEMA_FILTER="n.nspname = '$SCHEMA'"
    SCOPE="schemoje $SCHEMA"
else
    SCHEMA_FILTER="n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND n.nspname NOT LIKE 'pg_temp%'"
    SCOPE="duomenų bazėje"
fi

TABLES=$(docker exec viespirkiai_postgres psql -h localhost -U admin -d viespirkiai -At -F $'\t' -c "
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE $SCHEMA_FILTER
      AND c.relkind = 'r'
      AND c.relpersistence = 'p'
    ORDER BY pg_total_relation_size(c.oid) DESC
")

if [ -z "$TABLES" ]; then
    echo "Nerasta lentelių $SCOPE"
    exit 1
fi

TOTAL=$(echo "$TABLES" | wc -l)
OK=0
FAILED=()
I=0

while IFS=$'\t' read -r TABLE_SCHEMA TABLE; do
    I=$((I + 1))
    SIZE_BEFORE=$(docker exec viespirkiai_postgres psql -h localhost -U admin -d viespirkiai -At \
        -c "SELECT pg_size_pretty(pg_total_relation_size('\"$TABLE_SCHEMA\".\"$TABLE\"'))")

    echo
    echo "=== [$I/$TOTAL] $TABLE_SCHEMA.$TABLE ($SIZE_BEFORE) ==="

    if docker exec viespirkiai_postgres pg_repack -h localhost -U admin -d viespirkiai \
        --elevel=INFO \
        --echo \
        -t "\"$TABLE_SCHEMA\".\"$TABLE\""; then
        SIZE_AFTER=$(docker exec viespirkiai_postgres psql -h localhost -U admin -d viespirkiai -At \
            -c "SELECT pg_size_pretty(pg_total_relation_size('\"$TABLE_SCHEMA\".\"$TABLE\"'))")
        echo "--- $TABLE_SCHEMA.$TABLE: $SIZE_BEFORE -> $SIZE_AFTER"
        OK=$((OK + 1))
    else
        echo "--- $TABLE_SCHEMA.$TABLE: NEPAVYKO"
        FAILED+=("$TABLE_SCHEMA.$TABLE")
    fi
done <<< "$TABLES"

echo
echo "Baigta: $OK/$TOTAL"
if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Nepavyko: ${FAILED[*]}"
    exit 1
fi
