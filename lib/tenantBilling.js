/** Shared tenant billing rules (backend + scripts). */

import {
  computeQuarterEndFromCreatedAt,
  daysBetweenCalendar,
  SUBSCRIPTION_QUARTER_DAYS,
} from "./subscriptionPricing.js";

export { daysBetweenCalendar, SUBSCRIPTION_QUARTER_DAYS };

export function subscriptionBillingApplies(sub) {
  if (sub.isIllustrationTenant) return false;
  return Number(sub.quarterlyFeeETB ?? 0) > 0;
}

export function isFreeTrialActive(sub, now = new Date()) {
  if (!sub.freeTrialEndsAt) return false;
  const end = new Date(sub.freeTrialEndsAt);
  if (Number.isNaN(end.getTime())) return false;
  return now.getTime() < end.getTime();
}

/** Day 1 for quarter counting — only after hold is released. */
export function resolveBillingAnchor(sub) {
  if (sub.billingHold) return null;
  if (sub.billingStartedAt) {
    const d = new Date(sub.billingStartedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (sub.createdAt) {
    const d = new Date(sub.createdAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function paidQuartersFromAnchor(anchor, now = new Date()) {
  const days = Math.max(0, daysBetweenCalendar(anchor, now));
  return Math.floor(days / SUBSCRIPTION_QUARTER_DAYS) + 1;
}

/**
 * Setup fee Apex approval applies only to self-service signups (hotcol-user /SignUp)
 * that submitted a payment reference — not tenants provisioned by Apex or legacy rows.
 */
export function selfSignupAwaitingSetup(sub, pendingSetupSubmission = false) {
  if (sub.setupFeeApproved) return false;
  const setupFeeETB = Number(sub.setupFeeETB ?? 0);
  if (setupFeeETB <= 0) return false;
  if (pendingSetupSubmission) return true;
  const ref =
    sub.paymentTransactionRef != null
      ? String(sub.paymentTransactionRef).trim()
      : "";
  return ref.length >= 4;
}

/**
 * @returns {'exempt'|'on_hold'|'trial'|'setup_pending'|'pending_approval'|'active'|'warning'|'grace'|'expired'}
 */
export function computeSubscriptionPeriodStatus(
  sub,
  now = new Date(),
  options = {},
) {
  const { pendingSetupSubmission = false } = options;

  if (sub.isIllustrationTenant) return "exempt";
  if (sub.billingHold) return "on_hold";

  const quarterlyFeeETB = sub.quarterlyFeeETB ?? 0;
  if (Number(quarterlyFeeETB) <= 0) return "exempt";

  if (selfSignupAwaitingSetup(sub, pendingSetupSubmission)) {
    return "setup_pending";
  }

  if (isFreeTrialActive(sub, now)) {
    return "trial";
  }

  const anchor = resolveBillingAnchor(sub);
  if (!anchor) return "on_hold";

  const paidUntil = sub.subscriptionPaidUntil
    ? new Date(sub.subscriptionPaidUntil)
    : null;
  if (!paidUntil || Number.isNaN(paidUntil.getTime())) {
    // Apex-provisioned / legacy tenants may lack paidUntil — still allow access.
    return "active";
  }

  const daysUntilEnd = daysBetweenCalendar(now, paidUntil);

  // Paid quarter still in progress — do not ask for renewal at quarter start.
  if (daysUntilEnd > 10) return "active";
  if (daysUntilEnd >= 0) return "warning";

  const daysPast = -daysUntilEnd;
  if (daysPast >= 1 && daysPast < 10) {
    if (!sub.subscriptionPaymentApproved) return "grace";
    return "grace";
  }
  return "expired";
}

/** True when the paid quarter has ended (grace or expired). */
export function isPastPaidQuarterEnd(sub, now = new Date()) {
  const paidUntil = sub.subscriptionPaidUntil
    ? new Date(sub.subscriptionPaidUntil)
    : null;
  if (!paidUntil || Number.isNaN(paidUntil.getTime())) return false;
  return daysBetweenCalendar(now, paidUntil) < 0;
}

export function subscriptionAllowsFullSystemAccess(status) {
  return (
    status === "exempt" ||
    status === "on_hold" ||
    status === "trial" ||
    status === "active" ||
    status === "warning"
  );
}

export function resolveLoginAccess(user, subscription, periodStatus) {
  const isAdminManager = ["Admin", "Manager"].includes(user.Role);

  if (
    periodStatus === "exempt" ||
    periodStatus === "on_hold" ||
    periodStatus === "trial"
  ) {
    return { accessMode: "full", paymentKind: null };
  }

  // Quarterly verification only after quarter end (grace / expired), not at quarter start.
  const needsQuarterlyPortal =
    periodStatus === "grace" || periodStatus === "expired";

  if (periodStatus === "setup_pending") {
    return {
      accessMode: "denied",
      message:
        "Your registration is pending Apex approval. Login is disabled until your setup fee is verified (usually within about 30 minutes). For help, contact Apex on WhatsApp: +251935000642 or +251930272975.",
    };
  }

  if (needsQuarterlyPortal) {
    if (isAdminManager) {
      return { accessMode: "payment_portal", paymentKind: "quarterly" };
    }
    return {
      accessMode: "denied",
      message:
        periodStatus === "expired"
          ? "Login is disabled — the 10-day grace period after your quarter ended has passed. Pay Apex and contact support to restore access."
          : "Subscription renewal is in progress. Staff terminals are paused until Admin or Manager completes quarterly payment.",
    };
  }

  return { accessMode: "full", paymentKind: null };
}

export function tenantBillingRowFromOwner(row) {
  return {
    modules: row.modules,
    setupFeeETB: row.setupFeeETB ?? 0,
    quarterlyFeeETB: row.quarterlyFeeETB ?? 0,
    setupFeeApproved: Boolean(row.setupFeeApproved),
    createdAt: row.createdAt ?? null,
    billingStartedAt: row.billingStartedAt ?? null,
    billingHold: Boolean(row.billingHold),
    isIllustrationTenant: Boolean(row.isIllustrationTenant),
    freeTrialEndsAt: row.freeTrialEndsAt ?? null,
    billingNotes: row.billingNotes ?? null,
    subscriptionPaidUntil: row.subscriptionPaidUntil ?? null,
    subscriptionPaymentApproved: Boolean(row.subscriptionPaymentApproved),
    paidQuartersCount: row.paidQuartersCount ?? 0,
    paymentTransactionRef: row.paymentTransactionRef ?? null,
  };
}

/** Match illustration / discount tenants by display name (case-insensitive). */
export function tenantNamePolicy(hotelName) {
  const h = String(hotelName || "").trim().toLowerCase();
  if (h.includes("apex cafe") || h === "apex cafe and restaurant") {
    return { isIllustrationTenant: true };
  }
  if (h.includes("apex hotel")) {
    return { isIllustrationTenant: true };
  }
  if (h.includes("hafina")) {
    return { setupFeeETB: 15_000, billingNotes: "First café client — setup 15,000 ETB" };
  }
  if (h.includes("gebretsadik")) {
    return {
      setupFeeETB: 25_000,
      billingNotes: "First hotel client — setup 25,000 ETB",
    };
  }
  if (h.includes("ella kitchen")) {
    return {
      setupFeeETB: 25_000,
      billingNotes: "First hotel client — setup 25,000 ETB",
    };
  }
  return null;
}

export { computeQuarterEndFromCreatedAt };
