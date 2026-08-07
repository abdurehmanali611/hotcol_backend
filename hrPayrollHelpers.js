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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Inclusive calendar days in [fromYmd, toYmd]. */
export function inclusiveDayCount(fromYmd, toYmd) {
  const from = assertYmdLocal(fromYmd, "fromYmd");
  const to = assertYmdLocal(toYmd, "toYmd");
  if (to < from) return 0;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.floor((b - a) / 86400000) + 1;
}

/** Inclusive days where [aFrom,aTo] overlaps [bFrom,bTo]. */
export function overlapInclusiveDays(aFrom, aTo, bFrom, bTo) {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  if (to < from) return 0;
  return inclusiveDayCount(from, to);
}

/** List YYYY-MM-DD strings in inclusive range. */
export function eachYmdInRange(fromYmd, toYmd) {
  const from = assertYmdLocal(fromYmd, "fromYmd");
  const to = assertYmdLocal(toYmd, "toYmd");
  if (to < from) return [];
  const out = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const cursor = new Date(fy, fm - 1, fd);
  const [ty, tm, td] = to.split("-").map(Number);
  const end = new Date(ty, tm - 1, td);
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Daily rate for unpaid-leave / absence prorating.
 * monthly & tip_eligible → base / 30; weekly → base / 7; hourly → base (treated as daily).
 */
export function dailyRateETB(baseSalaryETB, wageType) {
  const base = Number(baseSalaryETB) || 0;
  const wt = String(wageType || "monthly").trim();
  if (wt === "weekly") return round2(base / 7);
  if (wt === "hourly") return round2(base);
  return round2(base / 30);
}

/**
 * Build earnings/deductions for one employee in a payroll From–To window.
 * Integrates: common line rules, recorded incidents, unpaid leave, attendance-linked types.
 */
export function buildIntegratedPayLines({
  employee,
  fromYmd,
  toYmd,
  appliedRules = [],
  incidents = [],
  unpaidLeaves = [],
  leaveTypeLabels = {},
  attendanceByDate = new Map(),
  leaveDates = new Set(),
  attendanceLinkedTypes = [],
}) {
  const gross = round2(Number(employee.baseSalaryETB) || 0);
  const earnings = [
    { label: "Gross salary", amountETB: gross },
    ...appliedRules
      .filter((r) => r.kind === "increase")
      .map((r) => ({
        label: r.label,
        amountETB: round2(Number(r.amountETB) || 0),
      })),
  ];
  const deductions = appliedRules
    .filter((r) => r.kind === "deduction")
    .map((r) => ({
      label: r.label,
      amountETB: round2(Number(r.amountETB) || 0),
    }));

  for (const inc of incidents) {
    const amount = round2(Number(inc.amountETB) || 0);
    if (amount <= 0) continue;
    const title =
      String(inc.title || "").trim() ||
      String(inc.kind || "Incident").trim() ||
      "Incident";
    if (inc.salaryDeduct) {
      deductions.push({
        label: `Incident · ${title}`,
        amountETB: amount,
      });
    } else {
      earnings.push({
        label: `Incident credit · ${title}`,
        amountETB: amount,
      });
    }
  }

  const rate = dailyRateETB(gross, employee.wageType);
  for (const leave of unpaidLeaves) {
    const days = overlapInclusiveDays(
      leave.fromYmd,
      leave.toYmd,
      fromYmd,
      toYmd,
    );
    if (days <= 0 || rate <= 0) continue;
    const typeLabel =
      leaveTypeLabels[leave.leaveType] ||
      String(leave.leaveType || "unpaid").replaceAll("_", " ");
    deductions.push({
      label: `Unpaid leave · ${typeLabel} (${days} day${days === 1 ? "" : "s"})`,
      amountETB: round2(rate * days),
    });
  }

  for (const type of attendanceLinkedTypes) {
    const link = String(type.attendanceLink || "").trim();
    const perDay = round2(Number(type.amountETB) || 0);
    if (!link || perDay <= 0) continue;
    let count = 0;
    for (const [ymd, status] of attendanceByDate) {
      if (leaveDates.has(ymd)) continue;
      if (status === link) count += 1;
    }
    if (count <= 0) continue;
    const verb = type.deduct === false ? "credit" : "deduct";
    const line = {
      label: `${type.label || link} · attendance (${count} day${count === 1 ? "" : "s"})`,
      amountETB: round2(perDay * count),
    };
    if (type.deduct === false) {
      earnings.push({ ...line, label: `${line.label} · ${verb}` });
    } else {
      deductions.push(line);
    }
  }

  const totalEarningsETB = round2(
    earnings.reduce((s, r) => s + r.amountETB, 0),
  );
  const totalDeductionsETB = round2(
    deductions.reduce((s, r) => s + r.amountETB, 0),
  );
  return {
    gross,
    earnings,
    deductions,
    totalEarningsETB,
    totalDeductionsETB,
    netPayETB: round2(totalEarningsETB - totalDeductionsETB),
  };
}

