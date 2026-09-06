#!/bin/bash
set -e

TABLE=${1:-}

# Lentelė be taško – `public` schemoje, vardą cituojame patys (camelCase).
# Su tašku – kvalifikuotas vardas (pvz. 'files."stats"'), tada cituoja kvietėjas:
# lentelės iškeltos iš `public` kitaip nepasiekiamos.
if [ -z "$TABLE" ]; then
    TABLE_ARG=()
elif [[ "$TABLE" == *.* ]]; then
    TABLE_ARG=(-t "$TABLE")
else
    TABLE_ARG=(-t "\"$TABLE\"")
fi

docker exec viespirkiai_postgres pg_repack -h localhost -U admin -d viespirkiai \
    --elevel=INFO \
    --echo \
    "${TABLE_ARG[@]}"
