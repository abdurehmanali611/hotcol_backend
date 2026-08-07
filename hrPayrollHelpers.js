/**
 * Payroll helpers — month naming for payslip titles from a From–To range.
 *
 * Rule: count inclusive days per Gregorian calendar month in [fromYmd, toYmd].
 * Name the payslip after the month with the most days. If two (or more) months
 * are tied, use the chronologically earlier month ("first month has ≥ days").
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function assertYmdLocal(value, field = "date") {
  const s = String(value ?? "").trim();
  if (!YMD_RE.test(s)) throw new Error(`${field} must be YYYY-MM-DD`);
  return s;
}

/** Inclusive day counts per YYYY-MM within [fromYmd, toYmd]. */
export function monthDayCountsInRange(fromYmd, toYmd) {
  const from = assertYmdLocal(fromYmd, "fromYmd");
  const to = assertYmdLocal(toYmd, "toYmd");
  if (to < from) throw new Error("toYmd must not be before fromYmd");

  const counts = new Map();
  const [fy, fm, fd] = from.split("-").map(Number);
  const cursor = new Date(fy, fm - 1, fd);
  const [ty, tm, td] = to.split("-").map(Number);
  const end = new Date(ty, tm - 1, td);

  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const key = `${y}-${m}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    cursor.setDate(cursor.getDate() + 1);
  }
  return counts;
}

/**
 * @returns {{ periodKey: string, monthName: string, dayCount: number }}
 */
export function namedMonthFromPayRange(fromYmd, toYmd) {
  const counts = monthDayCountsInRange(fromYmd, toYmd);
  let bestKey = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount && (bestKey == null || key < bestKey))
    ) {
      bestKey = key;
      bestCount = count;
    }
  }
  if (!bestKey) {
    const from = assertYmdLocal(fromYmd, "fromYmd");
    bestKey = from.slice(0, 7);
    bestCount = 0;
  }
  const monthIndex = Number(bestKey.slice(5, 7)) - 1;
  return {
    periodKey: bestKey,
    monthName: MONTH_NAMES[monthIndex] || bestKey,
    dayCount: bestCount,
  };
}

export function payslipNumberFor(employeeId, periodId, seq) {
  const e = String(employeeId).padStart(4, "0");
  const p = String(periodId).padStart(4, "0");
  const s = String(seq).padStart(3, "0");
  return `PS-${p}-${e}-${s}`;
}
