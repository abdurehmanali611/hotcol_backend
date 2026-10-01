/**
 * Hotel-defined tax / pension bands.
 * Pick the single matching band for salary; apply ratePercent to full base.
 * Uncovered below lowest From → 0% for that kind.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function assertStatBandShape(band) {
  const kind = String(band?.kind || "").trim();
  if (kind !== "tax" && kind !== "pension") {
    throw new Error("Statutory band kind must be tax or pension");
  }
  const rate = Number(band?.ratePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error("Statutory ratePercent must be 0–100");
  }
  const fromETB = Number(band?.fromETB);
  if (!Number.isFinite(fromETB) || fromETB < 0) {
    throw new Error("Statutory fromETB must be ≥ 0");
  }
  let toETB = null;
  if (band?.toETB != null && String(band.toETB).trim() !== "") {
    toETB = Number(band.toETB);
    if (!Number.isFinite(toETB) || toETB <= fromETB) {
      throw new Error("Statutory toETB must be greater than fromETB");
    }
  }
  const effectiveMode =
    String(band?.effectiveMode || "always").trim() === "date_range"
      ? "date_range"
      : "always";
  const fromYmd = String(band?.fromYmd || "").trim();
  const toYmd = String(band?.toYmd || "").trim();
  if (effectiveMode === "date_range") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) {
      throw new Error("date_range bands need fromYmd and toYmd (YYYY-MM-DD)");
    }
    if (toYmd < fromYmd) throw new Error("Band toYmd must not be before fromYmd");
  }
  return {
    kind,
    label: String(band?.label || "").trim(),
    ratePercent: rate,
    fromETB,
    toETB,
    effectiveMode,
    fromYmd: effectiveMode === "date_range" ? fromYmd : "",
    toYmd: effectiveMode === "date_range" ? toYmd : "",
    active: band?.active !== false,
    sortOrder: Number(band?.sortOrder) || 0,
  };
}

/** True if band is in force for asOfYmd (defaults today). */
export function bandEffectiveOn(band, asOfYmd) {
  if (band?.active === false) return false;
  if (String(band?.effectiveMode || "always") !== "date_range") return true;
  const day = String(asOfYmd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const from = String(band.fromYmd || "").trim();
  const to = String(band.toYmd || "").trim();
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function salaryMatchesBand(salaryETB, band) {
  const s = Number(salaryETB) || 0;
  const from = Number(band.fromETB) || 0;
  if (s < from) return false;
  if (band.toETB == null || band.toETB === "") return true;
  return s < Number(band.toETB);
}

/**
 * Validate no overlapping salary ranges among same kind + overlapping effective periods.
 */
export function assertNoStatBandOverlaps(bands) {
  const list = (bands || []).map(assertStatBandShape);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.kind !== b.kind) continue;
      if (!effectivePeriodsOverlap(a, b)) continue;
      if (salaryRangesOverlap(a, b)) {
        throw new Error(
          `Overlapping ${a.kind} bands: [${a.fromETB}–${a.toETB ?? "∞"}) and [${b.fromETB}–${b.toETB ?? "∞"})`,
        );
      }
    }
  }
  return list;
}

function effectivePeriodsOverlap(a, b) {
  if (a.effectiveMode === "always" || b.effectiveMode === "always") return true;
  return !(a.toYmd < b.fromYmd || b.toYmd < a.fromYmd);
}

function salaryRangesOverlap(a, b) {
  const aTo = a.toETB == null ? Number.POSITIVE_INFINITY : Number(a.toETB);
  const bTo = b.toETB == null ? Number.POSITIVE_INFINITY : Number(b.toETB);
  return a.fromETB < bTo && b.fromETB < aTo;
}

/**
 * Pick matching band for kind + salary + date. Returns null if none.
 */
export function pickStatBand(bands, { kind, salaryETB, asOfYmd }) {
  const k = String(kind || "").trim();
  const candidates = (bands || [])
    .filter((b) => String(b.kind) === k && bandEffectiveOn(b, asOfYmd))
    .filter((b) => salaryMatchesBand(salaryETB, b))
    .sort((a, b) => Number(a.fromETB) - Number(b.fromETB));
  return candidates[0] || null;
}

export function statutoryDeductionETB(bands, { kind, salaryETB, asOfYmd }) {
  const band = pickStatBand(bands, { kind, salaryETB, asOfYmd });
  if (!band) return { amountETB: 0, band: null };
  const amount = round2((Number(salaryETB) || 0) * (Number(band.ratePercent) || 0) / 100);
  return { amountETB: amount, band };
}

/**
 * Append tax + pension deduction lines for payslip build.
 */
export function appendStatutoryDeductions(deductions, bands, salaryETB, asOfYmd) {
  const out = [...(deductions || [])];
  for (const kind of ["tax", "pension"]) {
    const { amountETB, band } = statutoryDeductionETB(bands, {
      kind,
      salaryETB,
      asOfYmd,
    });
    if (!band || amountETB <= 0) continue;
    const label =
      String(band.label || "").trim() ||
      (kind === "tax" ? "Income tax" : "Pension");
    out.push({
      label: `${label} (${band.ratePercent}%)`,
      amountETB,
    });
  }
  return out;
}
