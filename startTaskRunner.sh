#!/bin/bash

DIR="$(dirname "$BASH_SOURCE")"

while true; do
    echo "$(date '+%Y-%m-%d %H:%M:%S')" >> "$DIR/taskRunnerStarts.txt"
    node taskRunner.js
    echo "Process exited. Restarting in 1 second..."
    sleep 0
done
