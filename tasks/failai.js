import { parsiustiFaila } from "../modules/failai/parsiusti.js";
import { pravalytiParsiuntimoRezervacijas } from "../modules/failai/pravalytiParsiuntimuRezervacijas.js";
import { pravalytiNuskaitymoRezervacijas } from "../modules/failai/pravalytiNuskaitymoRezervacijas.js";
import { pravalytiOcrRezervacijas } from "../modules/failai/pravalytiOcrRezervacijas.js";
import { WORK_SIGNALS } from "../utils/taskSignals.js";

export default [
    {
        name: "failuParsiuntimas",
        mode: "asap",
        priority: 10,
        cooldown: 5,
        errorCooldown: 0,
        wakeOn: [WORK_SIGNALS.FILES_DOWNLOAD_READY],
        job: parsiustiFaila,
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
        name: "pravalytiNuskaitymoRezervacijas",
        mode: "asap",
        priority: 4,
        cooldown: 60,
        errorCooldown: 60,
        job: pravalytiNuskaitymoRezervacijas,
    },
    {
        name: "pravalytiOcrRezervacijas",
        mode: "asap",
        priority: 4,
        cooldown: 60,
        errorCooldown: 60,
        job: pravalytiOcrRezervacijas,
    }
];
