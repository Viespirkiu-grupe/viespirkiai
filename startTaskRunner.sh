#!/bin/bash
set -euo pipefail
DIR="$(dirname "${BASH_SOURCE[0]}")"
child_pid=""
shutting_down=0

# Node paleidžiamas per `setsid`, todėl terminalo Ctrl+C pasiekia tik šį
# wrapperį. Kiekvieną gautą signalą persiunčiame vaikui ir trap'o NENUIMAME:
# antras Ctrl+C turi nueiti iki Node, kad suveiktų jo force-exit šaka. Anksčiau
# čia buvo `trap - INT TERM`, todėl antras Ctrl+C nužudydavo wrapperį, o Node
# likdavo našlaitis, prikabintas prie to paties terminalo.
forward_signal() {
    local signal="$1"
    shutting_down=1
    if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
        kill -s "$signal" "$child_pid"
    fi
}

trap 'forward_signal INT' INT
trap 'forward_signal TERM' TERM

while true; do
    echo "$(date '+%Y-%m-%d %H:%M:%S')" >> "$DIR/taskRunnerStarts.txt"
    tail -c 1048576 "$DIR/taskRunnerStarts.txt" > /tmp/_log_tmp && mv /tmp/_log_tmp "$DIR/taskRunnerStarts.txt"
    # Atskira sesija užtikrina, kad terminalo Ctrl+C pirmiausia pasiektų tik šį
    # wrapperį. Jis tada persiunčia signalus Node procesui.
    # Subshell'e atstatome signalų disposition prieš exec (background procesams
    # bash pagal nutylėjimą gali palikti SIGINT ignoruojamą).
    (
        trap - INT TERM
        exec setsid node "$DIR/tasks/index.js"
    ) &
    child_pid=$!

    # `wait` grįžta iš karto, kai gaunamas trap'intas signalas, todėl laukiame
    # cikle, kol vaikas iš tikrųjų pasibaigs.
    while kill -0 "$child_pid" 2>/dev/null; do
        wait "$child_pid" || true
    done
    child_pid=""

    if (( shutting_down )); then
        exit 0
    fi

    echo "Process exited. Restarting in 1 second..."
    sleep 1
done
