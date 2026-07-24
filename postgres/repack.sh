#!/bin/bash
set -e

TABLE=${1:-}

if [ -n "$TABLE" ]; then
    TABLE_ARG=(-t "\"$TABLE\"")
else
    TABLE_ARG=()
fi

docker exec viespirkiai_postgres pg_repack -h localhost -U admin -d viespirkiai \
    --elevel=INFO \
    --echo \
    "${TABLE_ARG[@]}"
