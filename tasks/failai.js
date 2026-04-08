import { parsiustiFaila } from "../modules/failai/parsiusti.js";
import { pravalytiParsiuntimoRezervacijas } from "../modules/failai/pravalytiParsiuntimuRezervacijas.js";
import { processFailaiIndexQueue } from "../modules/failai/quickwitProcessIndexQueue.js";

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
    {
        name: "quickwitProcessIndexQueue",
        mode: "asap",
        priority: 5,
        cooldown: 30,
        errorCooldown: 30,
        job: processFailaiIndexQueue,
    }
];
