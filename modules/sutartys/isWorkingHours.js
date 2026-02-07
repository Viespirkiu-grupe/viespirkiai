/**
 * Returns true if the Public Procurement Office in Lithuania
 * is currently open (working hours), considering weekends and public holidays.
 * @returns {boolean}
 */
export function isVptWorkingHours() {
    const now = new Date();

    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
            timeZone: "Europe/Vilnius",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        })
            .formatToParts(now)
            .map((p) => [p.type, p.value]),
    );

    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = dayMap[parts.weekday];
    const hours = Number(parts.hour);
    const minutes = Number(parts.minute);

    // Weekend
    if (day === 0 || day === 6) return false;

    const year = Number(parts.year);
    const todayStr = `${parts.year}-${parts.month}-${parts.day}`;

    const fixedHolidays = [
        `${year}-01-01`,
        `${year}-02-16`,
        `${year}-03-11`,
        `${year}-06-24`,
        `${year}-07-06`,
        `${year}-08-15`,
        `${year}-11-01`,
        `${year}-11-02`,
        `${year}-12-24`,
        `${year}-12-25`,
        `${year}-12-26`,
    ];

    const easterStr = getEasterDate(year);
    const movableHolidays = [
        addDaysStr(easterStr, -2),
        addDaysStr(easterStr, 1),
        addDaysStr(easterStr, 39),
        addDaysStr(easterStr, 49),
    ];

    if ([...fixedHolidays, ...movableHolidays].includes(todayStr)) {
        return false;
    }

    let openMinutes, closeMinutes;
    if (day >= 1 && day <= 4) {
        openMinutes = 8 * 60;
        closeMinutes = 17 * 60;
    } else {
        openMinutes = 8 * 60;
        closeMinutes = 15 * 60 + 45;
    }

    const nowMinutes = hours * 60 + minutes;
    return nowMinutes >= openMinutes && nowMinutes < closeMinutes;

    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    function addDaysStr(dateStr, n) {
        const [y, m, d] = dateStr.split("-").map(Number);
        const date = new Date(Date.UTC(y, m - 1, d));
        date.setUTCDate(date.getUTCDate() + n);
        return `${date.getUTCFullYear()}-${pad2(
            date.getUTCMonth() + 1,
        )}-${pad2(date.getUTCDate())}`;
    }

    function getEasterDate(year) {
        const f = Math.floor,
            G = year % 19,
            C = f(year / 100),
            H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30,
            I =
                H -
                f(H / 28) *
                    (1 - f(H / 28) * f(29 / (H + 1)) * f((21 - G) / 11)),
            J = (year + f(year / 4) + I + 2 - C + f(C / 4)) % 7,
            L = I - J,
            month = 3 + f((L + 40) / 44),
            day = L + 28 - 31 * f(month / 4);

        return `${year}-${pad2(month)}-${pad2(day)}`;
    }
}
