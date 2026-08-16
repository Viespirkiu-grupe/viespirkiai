#!/bin/bash
set -e

SCHEMA=${1:-public}

TABLES=$(docker exec viespirkiai_postgres psql -h localhost -U admin -d viespirkiai -At -c "
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '$SCHEMA'
      AND c.relkind = 'r'
      AND c.relpersistence = 'p'
    ORDER BY pg_total_relation_size(c.oid) DESC
")

if [ -z "$TABLES" ]; then
    echo "Nerasta lentelių schemoje $SCHEMA"
    exit 1
fi

TOTAL=$(echo "$TABLES" | wc -l)
OK=0
FAILED=()
I=0

while IFS= read -r TABLE; do
    I=$((I + 1))
    SIZE_BEFORE=$(docker exec viespirkiai_postgres psql -h localhost -U admin -d viespirkiai -At \
        -c "SELECT pg_size_pretty(pg_total_relation_size('\"$SCHEMA\".\"$TABLE\"'))")

    echo
    echo "=== [$I/$TOTAL] $SCHEMA.$TABLE ($SIZE_BEFORE) ==="

    if docker exec viespirkiai_postgres pg_repack -h localhost -U admin -d viespirkiai \
        --elevel=INFO \
        --echo \
        -t "\"$SCHEMA\".\"$TABLE\""; then
        SIZE_AFTER=$(docker exec viespirkiai_postgres psql -h localhost -U admin -d viespirkiai -At \
            -c "SELECT pg_size_pretty(pg_total_relation_size('\"$SCHEMA\".\"$TABLE\"'))")
        echo "--- $TABLE: $SIZE_BEFORE -> $SIZE_AFTER"
        OK=$((OK + 1))
    else
        echo "--- $TABLE: NEPAVYKO"
        FAILED+=("$TABLE")
    fi
done <<< "$TABLES"

echo
echo "Baigta: $OK/$TOTAL"
if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Nepavyko: ${FAILED[*]}"
    exit 1
fi
