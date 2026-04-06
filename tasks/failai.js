import { parsiustiFaila } from "../modules/failai/parsiusti.js";
import { pravalytiParsiuntimoRezervacijas } from "../modules/failai/pravalytiParsiuntimuRezervacijas.js";

export default [
    {
        name: "failuParsiuntimas",
        mode: "asap",
        priority: 10,
        cooldown: 5,
        errorCooldown: 0,
        job: parsiustiFaila,
        onSuccess: (runner) => {
            for (const taskName of runner.taskNames()) {
                if (taskName.startsWith("nuskaitytiDokumenta")) {
                    runner.nudge(taskName);
                }
            }
        },
    },
    {
        name: "pravalytiParsiuntimoRezervacijas",
        mode: "asap",
        priority: 4,
        cooldown: 60,
        errorCooldown: 60,
        job: pravalytiParsiuntimoRezervacijas,
    },
];
