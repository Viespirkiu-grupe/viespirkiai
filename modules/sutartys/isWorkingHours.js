/**
 * Returns true if the Public Procurement Office in Lithuania
 * is currently open (working hours), considering weekends and public holidays.
 * @returns {boolean}
 */
export function isVptWorkingHours() {
    const now = new Date();

    // Lithuania local time
    const ltDate = new Date(
        now.toLocaleString("en-GB", { timeZone: "Europe/Vilnius" }),
    );
    const day = ltDate.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    const hours = ltDate.getHours();
    const minutes = ltDate.getMinutes();

    // Weekends
    if (day === 0 || day === 6) return false;

    const year = ltDate.getFullYear();
    const pad2 = (n) => String(n).padStart(2, "0");
    const todayStr = `${year}-${pad2(ltDate.getMonth() + 1)}-${pad2(
        ltDate.getDate(),
    )}`;

    // Fixed holidays
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

    // Movable holidays (Easter-based)
    const easterStr = getEasterDate(year);
    const movableHolidays = [
        addDaysStr(easterStr, -2), // Good Friday
        addDaysStr(easterStr, 1), // Easter Monday
        addDaysStr(easterStr, 39), // Ascension Day
        addDaysStr(easterStr, 49), // Pentecost
    ];

    const allHolidays = [...fixedHolidays, ...movableHolidays];

    if (allHolidays.includes(todayStr)) return false;

    // Working hours
    let openMinutes, closeMinutes;
    if (day >= 1 && day <= 4) {
        openMinutes = 8 * 60; // 08:00
        closeMinutes = 17 * 60; // 17:00
    } else if (day === 5) {
        openMinutes = 8 * 60;
        closeMinutes = 15 * 60 + 45; // 15:45
    } else {
        return false;
    }

    const nowMinutes = hours * 60 + minutes;
    return nowMinutes >= openMinutes && nowMinutes < closeMinutes;

    // --- Helper functions ---
    function addDaysStr(dateStr, n) {
        const [y, m, d] = dateStr.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        date.setDate(date.getDate() + n);
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
            date.getDate(),
        )}`;
    }

    // Returns Easter Sunday as a string YYYY-MM-DD
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
