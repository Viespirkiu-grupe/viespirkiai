import { performance } from "perf_hooks";

/**
 * Class to track timings
 */
export default class Timings {
    constructor() {
        this.timings = {};
        this.start("all");
    }

    /**
     * Start a timing
     * @param {string} name - name of the timing
     */
    start(name) {
        if (!this.timings[name]) {
            this.timings[name] = {
                start: performance.now(),
            };
        }
    }

    /**
     * End a timing
     * @param {string} name - name of the timing
     * @returns {number} - duration of the timing
     */
    end(name) {
        this.timings[name].end = performance.now();
    }

    /**
     * Get the duration of a timing
     * @param {string} name - name of the timing
     * @returns {number} - duration of the timing
     */
    humanDuration(name) {
        if (!name) {
            name = "all";
        }

        let timing = this.timings[name];
        let duration = (timing.end || performance.now()) - timing.start;
        return formatTime(duration);
    }

    /**
     * Get the duration of all timings
     * @returns {number} - duration of all timings
     * @returns {object} - formatted duration of all timings
     */
    json() {
        // calculate the durations
        for (let name in this.timings) {
            let timing = this.timings[name];
            timing.duration = timing.end - timing.start;
        }
        return this.timings;
    }

    /**
     * Get the duration of all timings
     * @returns {string} - formatted duration of all timings
     */
    serverTiming() {
        this.end("all");
        let timings = [];
        for (let name in this.timings) {
            let timing = this.timings[name];
            timings.push(`${name};dur=${timing.end - timing.start}`);
        }
        return timings.join(", ");
    }
}

/**
 * Formats a duration (ms) into a human-readable string
 * @param {Number} duration Duration in milliseconds
 * @param {Number} precision Number of decimal places to show, defaults to 2
 * @returns {String} Formatted time string
 * @example formatTime(1234.5678, 2); // "1.23s"
 */
export function formatTime(duration, precision = 2) {
    let formattedTime;

    if (duration < 1) {
        formattedTime = (duration * 1000).toFixed(precision) + "us";
    } else if (duration < 1000) {
        formattedTime = duration.toFixed(precision) + "ms";
    } else if (duration < 60 * 1000) {
        formattedTime = (duration / 1000).toFixed(precision) + "s";
    } else if (duration < 60 * 60 * 1000) {
        formattedTime = (duration / (60 * 1000)).toFixed(precision) + "min";
    } else if (duration < 24 * 60 * 60 * 1000) {
        formattedTime = (duration / (60 * 60 * 1000)).toFixed(precision) + "h";
    } else {
        formattedTime =
            (duration / (24 * 60 * 60 * 1000)).toFixed(precision) + "d";
    }

    return formattedTime;
}
