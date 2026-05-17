#!/bin/bash
set -e

TABLE=${1:?"Naudojimas: $0 <lentelės_pavadinimas>"}

docker exec viespirkiai_postgres pg_repack -h localhost -U admin -d viespirkiai \
    --elevel=INFO \
    --echo \
    -t "\"$TABLE\""
