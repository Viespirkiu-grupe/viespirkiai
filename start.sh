#!/bin/bash

set -euo pipefail

DIR="$(dirname "${BASH_SOURCE[0]}")"

while true; do
    echo "$(date '+%Y-%m-%d %H:%M:%S')" >> "$DIR/starts.txt"
    tail -c 1048576 "$DIR/starts.txt" > /tmp/_log_tmp && mv /tmp/_log_tmp "$DIR/starts.txt"
    node $DIR/server.js
    echo "Process exited. Restarting in 1 second..."
    sleep 1
done
