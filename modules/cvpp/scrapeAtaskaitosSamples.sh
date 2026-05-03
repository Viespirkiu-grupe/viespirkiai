#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

run() {
    local name=$1 id=$2 ft=$3
    echo "Scraping $name ($id, formTypeId=$ft)..."
    node "$DIR/scrapeAtaskaitosContent.js" "$id" "$ft" > "$DIR/${name}.json"
    echo "  -> ${name}.json"
}

run atn1   2017-624732 1
run atn3   2024-613433 3
run atgn1  2024-677876 4
run atgn2  2024-650900 5
run atk1   2024-698325 6

echo "Done."
