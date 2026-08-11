#!/bin/bash
set -euo pipefail
DIR="$(dirname "${BASH_SOURCE[0]}")"
child_pid=""

shutdown() {
    local signal="$1"
    trap - INT TERM
    # Priklausomai nuo shell/job-control režimo background Node gali arba gauti
    # terminalo signalą tiesiogiai, arba jo negauti. Visada persiunčiame, o Node
    # trumpame lange pasikartojusį tos pačios operacijos signalą nuslopina.
    if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
        kill -s "$signal" "$child_pid"
        wait "$child_pid" || true
    fi
    exit 0
}

trap 'shutdown INT' INT
trap 'shutdown TERM' TERM

while true; do
    echo "$(date '+%Y-%m-%d %H:%M:%S')" >> "$DIR/taskRunnerStarts.txt"
    tail -c 1048576 "$DIR/taskRunnerStarts.txt" > /tmp/_log_tmp && mv /tmp/_log_tmp "$DIR/taskRunnerStarts.txt"
    # Atskira sesija užtikrina, kad terminalo Ctrl+C pirmiausia pasiektų tik šį
    # wrapperį. Jis tada persiunčia lygiai vieną signalą Node procesui.
    # Subshell'e atstatome signalų disposition prieš exec (background procesams
    # bash pagal nutylėjimą gali palikti SIGINT ignoruojamą).
    (
        trap - INT TERM
        exec setsid node "$DIR/tasks/index.js"
    ) &
    child_pid=$!
    wait "$child_pid" || true
    child_pid=""
    echo "Process exited. Restarting in 1 second..."
    sleep 1
done
