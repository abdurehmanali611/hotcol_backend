/**
 * HR Module — Phase 2 GraphQL API.
 * Employee master, leave requests + balances, attendance/shifts, document
 * metadata, payroll periods + payslips, incidents/warnings.
 *
 * Explicitly out of scope: job posting, applicants, recruiting pipeline,
 * employee self-service login.
 *
 * Wired into BackEnd/index.js (types + Query/Mutation fields + resolvers),
 * following the pattern established by lodgingGraphql.js.
 */

import {
  namedMonthFromPayRange,
  payslipNumberFor,
  buildIntegratedPayLines,
  eachYmdInRange,
  inclusiveDayCount,
} from "./hrPayrollHelpers.js";
import {
  issueUniquePortalOtp,
  clearPortalOtpLoginFields,
} from "./hrPortalOtp.js";
import {
  createHrNotification,
  listHrNotificationsForActor,
  markHrNotificationRead,
  createHrEmployeeNotifications,
  notifyEmployeeLeaveDecision,
  notifyEmployeesPayslipReady,
  notifyEmployeesPayslipMarkedPaid,
} from "./hrNotifications.js";
import {
  decideLeaveOnEngine,
  defaultSteps,
  effectiveSteps,
  normalizeSteps,
  prepareLeaveFlowAttachment,
  recordEscalations,
  resolveAssignees,
  STEP_KINDS,
} from "./hrApprovalEngine.js";
import {
  createManagerPendingAction,
  isDeskManagerOrAdmin,
} from "./hrManagerPending.js";
import { parseModulesJson } from "./lib/subscriptionPricing.js";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORG_POSITIONS = new Set(["leader", "employee"]);

const EMPLOYEE_STATUSES = new Set(["active", "on_leave", "terminated"]);
const WAGE_TYPES = new Set(["monthly", "weekly"]);
const LEAVE_STATUSES = new Set(["pending", "approved", "rejected", "cancelled"]);
const ATTENDANCE_STATUSES = new Set([
  "present",
  "late",
  "absent",
  "half_day",
  "on_leave",
]);
const ATTENDANCE_LINK_VALUES = new Set(["", "absent", "late", "half_day"]);
const DOC_TYPES = new Set(["contract", "id", "certificate", "other"]);
const PAYROLL_PERIOD_STATUSES = new Set([
  "open",
  "awaiting_manager",
  "approved",
  "closed",
]);
const PAYSLIP_PAYMENT_STATUSES = new Set([
  "unpaid",
  "awaiting_finance",
  "marked_paid",
  "approved",
]);
const PAYROLL_LINE_KINDS = new Set(["deduction", "increase"]);
const HR_STAFF_ROLES = ["HR", "Admin", "Manager"];
/** Leave type config + leave approve/reject + payroll rules / approve pay. */
const HR_LEAVE_MANAGER_ROLES = ["Manager", "Admin"];

export const hrTypeDefsBlock = `
  type HrEmployee {
    id: Int!
    HotelName: String!
    fullName: String!
    phone: String!
    email: String!
    department: String!
    jobTitle: String!
    """leader | employee"""
    orgPosition: String!
    teamId: Int
    status: String!
    hireDate: String!
    endDate: String!
    wageType: String!
    baseSalaryETB: Float!
    bankName: String!
    accountNumber: String!
    credentialUserId: Int
    credentialUserName: String!
    notes: String!
    portalOtpHash: String!
    """Plaintext OTP only when caller matches portalOtpViewer; else empty."""
    portalOtpPreview: String!
    portalOtpViewer: String!
    mustChangeOtp: Boolean!
    portalOtpIssuedAt: DateTime
    portalFirstLoginAt: DateTime
    profileImageUrl: String!
    gender: String!
    education: String!
    personalTin: String!
    medicalNote: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type HrTeam {
    id: Int!
    HotelName: String!
    departmentId: Int!
    code: String!
    label: String!
    active: Boolean!
    sortOrder: Int!
  }

  type HrApprovalFlow {
    id: Int!
    HotelName: String!
    requestType: String!
    departmentId: Int
    requireTeamLeaderFirst: Boolean!
    stepsJson: JSON!
    active: Boolean!
  }

  type HrNotification {
    id: Int!
    HotelName: String!
    recipientRole: String!
    employeeId: Int
    kind: String!
    title: String!
    body: String!
    href: String!
    actionStatus: String!
    createdBy: String!
    readAt: DateTime
    createdAt: DateTime!
  }

  type HrManagerPendingAction {
    id: Int!
    HotelName: String!
    """terminate | attendance_correction | payroll_generate"""
    kind: String!
    employeeId: Int
    payloadJson: JSON
    requestedBy: String!
    status: String!
    decidedBy: String!
    decidedAt: DateTime
    createdAt: DateTime!
    employee: HrEmployee
  }

  type HrOtpResetRequest {
    id: Int!
    HotelName: String!
    employeeId: Int!
    requestedBy: String!
    status: String!
    decidedBy: String!
    decidedAt: DateTime
    createdAt: DateTime!
    """Present only for Manager/Admin when status=approved and preview still visible."""
    portalOtpPreview: String!
    employee: HrEmployee
  }

  type HrLeaveBalance {
    id: Int!
    HotelName: String!
    employeeId: Int!
    leaveType: String!
    balanceDays: Float!
    updatedAt: DateTime!
    employee: HrEmployee
  }

  type HrLeaveRequest {
    id: Int!
    HotelName: String!
    employeeId: Int!
    leaveType: String!
    fromYmd: String!
    toYmd: String!
    days: Float!
    reason: String!
    status: String!
    flowId: Int
    currentStepIndex: Int!
    """Resolved kind for the waiting step when status=pending (hr, manager, …)."""
    currentStepKind: String!
    decidedBy: String!
    decidedAt: DateTime
    createdAt: DateTime!
    employee: HrEmployee
  }

  type HrAttendance {
    id: Int!
    HotelName: String!
    employeeId: Int!
    workDate: String!
    clockInAt: DateTime
    clockOutAt: DateTime
    status: String!
    notes: String!
    createdAt: DateTime!
    employee: HrEmployee
  }

  type HrShift {
    id: Int!
    HotelName: String!
    employeeId: Int!
    workDate: String!
    department: String!
    startTime: String!
    endTime: String!
    notes: String!
    createdAt: DateTime!
    employee: HrEmployee
  }

  type HrDocument {
    id: Int!
    HotelName: String!
    employeeId: Int!
    title: String!
    docType: String!
    fileUrl: String!
    notes: String!
    createdAt: DateTime!
    employee: HrEmployee
  }

  type HrPayrollPeriod {
    id: Int!
    HotelName: String!
    periodKey: String!
    monthName: String!
    fromYmd: String!
    toYmd: String!
    status: String!
    notes: String!
    createdBy: String!
    closedAt: DateTime
    closedBy: String!
    createdAt: DateTime!
  }

  type HrPayslipLine {
    label: String!
    amountETB: Float!
  }

  type HrPayslip {
    id: Int!
    HotelName: String!
    periodId: Int!
    employeeId: Int!
    payslipNumber: String!
    employeeName: String!
    jobTitle: String!
    taxPeriod: String!
    organizationLocation: String!
    payDate: String!
    hireDate: String!
    wageType: String!
    bankName: String!
    accountNumber: String!
    basePayETB: Float!
    overtimeETB: Float!
    tipsETB: Float!
    deductionsETB: Float!
    netPayETB: Float!
    grossSalaryETB: Float!
    totalEarningsETB: Float!
    totalDeductionsETB: Float!
    earnings: [HrPayslipLine!]!
    deductions: [HrPayslipLine!]!
    paymentStatus: String!
    hrMarkedPaidAt: DateTime
    hrMarkedPaidBy: String!
    managerApprovedAt: DateTime
    managerApprovedBy: String!
    notes: String!
    createdAt: DateTime!
    employee: HrEmployee
    period: HrPayrollPeriod
  }

  type HrPayrollLineRule {
    id: Int!
    HotelName: String!
    kind: String!
    label: String!
    percentOfSalary: Float!
    amountETB: Float!
    whenMode: String!
    fromDay: Int
    toDay: Int
    fromYmd: String!
    toYmd: String!
    customized: Boolean!
    fromAmountETB: Float!
    toAmountETB: Float
    active: Boolean!
    sortOrder: Int!
  }

  input HrPayrollLineRuleInput {
    kind: String!
    label: String!
    percentOfSalary: Float
    amountETB: Float
    whenMode: String
    fromDay: Int
    toDay: Int
    fromYmd: String
    toYmd: String
    customized: Boolean
    fromAmountETB: Float
    toAmountETB: Float
    active: Boolean
  }

  type HrWagePayWindow {
    id: Int!
    HotelName: String!
    wageType: String!
    fromDay: Int!
    toDay: Int!
    active: Boolean!
  }

  input HrWagePayWindowInput {
    wageType: String!
    fromDay: Int!
    toDay: Int!
    active: Boolean
  }

  type HrIncident {
    id: Int!
    HotelName: String!
    employeeId: Int!
    kind: String!
    title: String!
    detail: String!
    occurredYmd: String!
    recordedBy: String!
    salaryDeduct: Boolean!
    percentOfSalary: Float!
    amountETB: Float!
    createdAt: DateTime!
    employee: HrEmployee
  }

  type HrDashboardStats {
    headcount: Int!
    onLeaveToday: Int!
    pendingLeave: Int!
    openShiftsToday: Int!
    openPayrollPeriods: Int!
  }

  type HrLeaveType {
    id: Int!
    HotelName: String!
    code: String!
    label: String!
    paid: Boolean!
    defaultDays: Float!
    active: Boolean!
    sortOrder: Int!
  }

  input HrLeaveTypeInput {
    code: String
    label: String!
    paid: Boolean
    defaultDays: Float
    active: Boolean
  }

  type HrDepartment {
    id: Int!
    HotelName: String!
    code: String!
    label: String!
    active: Boolean!
    sortOrder: Int!
  }

  input HrDepartmentInput {
    code: String
    label: String!
    active: Boolean
  }

  type HrIncidentType {
    id: Int!
    HotelName: String!
    code: String!
    label: String!
    deduct: Boolean!
    percentOfSalary: Float!
    amountETB: Float!
    attendanceLink: String!
    active: Boolean!
    sortOrder: Int!
  }

  input HrIncidentTypeInput {
    code: String
    label: String!
    deduct: Boolean
    percentOfSalary: Float
    amountETB: Float
    attendanceLink: String
    active: Boolean
  }
`;

export const hrQueryFields = `
    hrEmployees: [HrEmployee!]!
    hrEmployee(id: Int!): HrEmployee
    hrEmployeeMe: HrEmployee
    hrLeaveTypes: [HrLeaveType!]!
    hrDepartments: [HrDepartment!]!
    hrTeams(departmentId: Int): [HrTeam!]!
    hrApprovalFlows(requestType: String): [HrApprovalFlow!]!
    hrIncidentTypes: [HrIncidentType!]!
    hrLeaveRequests(status: String): [HrLeaveRequest!]!
    hrLeaveBalances(employeeId: Int): [HrLeaveBalance!]!
    hrAttendance(fromYmd: String, toYmd: String, employeeId: Int): [HrAttendance!]!
    hrShifts(fromYmd: String, toYmd: String, employeeId: Int): [HrShift!]!
    hrDocuments(employeeId: Int): [HrDocument!]!
    hrPayrollPeriods: [HrPayrollPeriod!]!
    hrPayslips(periodId: Int, paymentStatus: String): [HrPayslip!]!
    hrPayrollLineRules: [HrPayrollLineRule!]!
    hrWagePayWindows: [HrWagePayWindow!]!
    hrIncidents(employeeId: Int): [HrIncident!]!
    hrDashboardStats: HrDashboardStats!
    hrNotifications(unreadOnly: Boolean): [HrNotification!]!
    hrOtpResetRequests(status: String): [HrOtpResetRequest!]!
    hrManagerPendingActions(status: String): [HrManagerPendingAction!]!
`;

export const hrMutationFields = `
    createHrEmployee(
      fullName: String!
      phone: String
      email: String
      department: String
      jobTitle: String
      orgPosition: String
      teamId: Int
      hireDate: String
      wageType: String
      baseSalaryETB: Float
      bankName: String
      accountNumber: String
      credentialUserId: Int
      credentialUserName: String
      notes: String
      gender: String
      education: String
      personalTin: String
      medicalNote: String
    ): HrEmployee!
    updateHrEmployee(
      id: Int!
      fullName: String
      phone: String
      email: String
      department: String
      jobTitle: String
      orgPosition: String
      teamId: Int
      status: String
      hireDate: String
      wageType: String
      baseSalaryETB: Float
      bankName: String
      accountNumber: String
      credentialUserId: Int
      credentialUserName: String
      notes: String
      gender: String
      education: String
      personalTin: String
      medicalNote: String
    ): HrEmployee!
    terminateHrEmployee(id: Int!, endDate: String): HrEmployee!
    deleteHrEmployee(id: Int!): Boolean!

    replaceHrLeaveTypes(types: [HrLeaveTypeInput!]!): [HrLeaveType!]!
    replaceHrDepartments(departments: [HrDepartmentInput!]!): [HrDepartment!]!
    replaceHrIncidentTypes(types: [HrIncidentTypeInput!]!): [HrIncidentType!]!

    upsertHrTeam(
      id: Int
      departmentId: Int!
      code: String!
      label: String!
      active: Boolean
      sortOrder: Int
    ): HrTeam!
    deleteHrTeam(id: Int!): Boolean!

    upsertHrApprovalFlow(
      id: Int
      requestType: String!
      departmentId: Int
      requireTeamLeaderFirst: Boolean
      stepsJson: JSON!
      active: Boolean
    ): HrApprovalFlow!
    deleteHrApprovalFlow(id: Int!): Boolean!

    upsertHrLeaveBalance(
      employeeId: Int!
      leaveType: String!
      balanceDays: Float!
    ): HrLeaveBalance!
    createHrLeaveRequest(
      employeeId: Int!
      leaveType: String!
      fromYmd: String!
      toYmd: String!
      days: Float
      reason: String
    ): HrLeaveRequest!
    decideHrLeaveRequest(id: Int!, approve: Boolean!, note: String): HrLeaveRequest!

    clockHrAttendance(employeeId: Int!, action: String!): HrAttendance!
    upsertHrAttendance(
      employeeId: Int!
      workDate: String!
      clockInAt: DateTime
      clockOutAt: DateTime
      status: String
      notes: String
    ): HrAttendance!

    createHrShift(
      employeeId: Int!
      workDate: String!
      department: String
      startTime: String
      endTime: String
      notes: String
    ): HrShift!
    deleteHrShift(id: Int!): Boolean!

    createHrDocument(
      employeeId: Int!
      title: String!
      docType: String
      fileUrl: String
      notes: String
    ): HrDocument!
    deleteHrDocument(id: Int!): Boolean!

    createHrPayrollPeriod(
      fromYmd: String!
      toYmd: String!
      notes: String
      employeeIds: [Int!]
      wageScope: String
    ): HrPayrollPeriod!
    markHrPayslipsPaid(payslipIds: [Int!]!): [HrPayslip!]!
    """Finance (or Admin) approve/reject HR mark-paid requests."""
    decideHrPayslipsPayment(payslipIds: [Int!]!, approve: Boolean!): [HrPayslip!]!
    approveHrPayslipsPayment(payslipIds: [Int!]!): [HrPayslip!]!
    """Close a payroll run once every payslip is marked paid (HR+Finance/Manager)."""
    closeHrPayrollPeriod(id: Int!): HrPayrollPeriod!
    replaceHrPayrollLineRules(rules: [HrPayrollLineRuleInput!]!): [HrPayrollLineRule!]!
    replaceHrWagePayWindows(windows: [HrWagePayWindowInput!]!): [HrWagePayWindow!]!

    createHrIncident(
      employeeId: Int!
      kind: String
      title: String!
      detail: String
      occurredYmd: String
      recordedBy: String
      salaryDeduct: Boolean
      percentOfSalary: Float
      amountETB: Float
    ): HrIncident!
    deleteHrIncident(id: Int!): Boolean!

    """Issue / re-issue portal OTP after hire; preview visible to HR until first login."""
    enableHrEmployeePortal(id: Int!): HrEmployee!
    requestHrOtpReset(employeeId: Int!): HrOtpResetRequest!
    decideHrOtpReset(id: Int!, approve: Boolean!): HrOtpResetRequest!
    decideHrManagerPendingAction(id: Int!, approve: Boolean!): HrManagerPendingAction!
    markHrNotificationRead(id: Int!): HrNotification!
    createHrEmployeeNotification(
      employeeIds: [Int!]!
      title: String!
      body: String!
      href: String
    ): [HrNotification!]!
`;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function requireTenant(context, tenantScopeFromContext) {
  const HotelName = tenantScopeFromContext(context);
  if (!HotelName) throw new Error("Tenant scope missing");
  return HotelName;
}

function actorFromContext(context) {
  const u = context?.user;
  return {
    actorRole: String(u?.Role ?? u?.role ?? ""),
    actorName: String(u?.UserName ?? u?.userName ?? ""),
  };
}

/** Mask portal OTP preview unless caller role matches portalOtpViewer. */
function visiblePortalOtpPreview(employee, context) {
  const preview = String(employee?.portalOtpPreview ?? "").trim();
  if (!preview) return "";
  const viewer = String(employee?.portalOtpViewer ?? "none").trim();
  const { actorRole } = actorFromContext(context);
  if (viewer === "HR" && (actorRole === "HR" || actorRole === "Admin")) {
    return preview;
  }
  if (
    viewer === "Manager" &&
    (actorRole === "Manager" || actorRole === "Admin")
  ) {
    return preview;
  }
  return "";
}

function assertYmd(value, label) {
  const s = String(value ?? "").trim();
  if (!YMD_RE.test(s)) throw new Error(`${label} must be YYYY-MM-DD`);
  return s;
}

function todayYmd() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Block new leave while the employee is currently on approved leave. */
async function assertEmployeeCanRequestLeave(db, employee) {
  if (!employee) throw new Error("Employee not found");
  if (String(employee.status || "") === "terminated") {
    throw new Error("Terminated employees cannot request leave");
  }
  const today = todayYmd();
  if (String(employee.status || "") === "on_leave") {
    throw new Error(
      "Employee is currently on leave and cannot request another leave",
    );
  }
  const activeLeave = await db.hr_leave_request.findFirst({
    where: {
      employeeId: employee.id,
      status: "approved",
      fromYmd: { lte: today },
      toYmd: { gte: today },
    },
    select: { id: true, fromYmd: true, toYmd: true },
  });
  if (activeLeave) {
    throw new Error(
      `Employee is on leave (${activeLeave.fromYmd} → ${activeLeave.toYmd}) and cannot request another leave`,
    );
  }
}

/**
 * Prevent a second payroll for the same wage type + period.
 * Monthly: one run per named month (periodKey) for monthly payslips.
 * Weekly: one run per From–To week for weekly payslips (no overlapping weekly runs).
 */
async function assertNoDuplicateWagePeriodPayroll(
  prisma,
  { HotelName, from, to, wageScope, employeeIds },
) {
  const named = namedMonthFromPayRange(from, to);
  const idFilter = Array.isArray(employeeIds)
    ? employeeIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  let scope = String(wageScope ?? "").trim().toLowerCase();
  if (idFilter.length) scope = "employee";
  if (!scope) scope = "batch";

  const exact = await prisma.hr_payroll_period.findUnique({
    where: {
      HotelName_fromYmd_toYmd: { HotelName, fromYmd: from, toYmd: to },
    },
  });
  // Only a pending_generate stub for the exact same dates may be replaced.
  if (exact && String(exact.status || "") !== "pending_generate") {
    throw new Error(
      "A payroll run already exists for this From–To range. Choose different dates.",
    );
  }

  const checkMonthly = scope === "monthly" || scope === "batch" || scope === "employee";
  const checkWeekly = scope === "weekly" || scope === "batch" || scope === "employee";

  if (checkMonthly) {
    const monthPeriods = await prisma.hr_payroll_period.findMany({
      where: {
        HotelName,
        periodKey: named.periodKey,
        ...(exact ? { id: { not: exact.id } } : {}),
      },
      select: { id: true, monthName: true, fromYmd: true, toYmd: true },
    });
    if (monthPeriods.length) {
      const periodIds = monthPeriods.map((p) => p.id);
      const monthlyWhere = {
        periodId: { in: periodIds },
        wageType: "monthly",
      };
      if (idFilter.length) monthlyWhere.employeeId = { in: idFilter };
      const monthlyCount = await prisma.hr_payslip.count({
        where: monthlyWhere,
      });
      if (monthlyCount > 0) {
        const label = named.monthName || named.periodKey;
        throw new Error(
          `A monthly payroll for ${label} already exists. Cannot generate another monthly run for the same month.`,
        );
      }
    }
  }

  if (checkWeekly) {
    const overlapping = await prisma.hr_payroll_period.findMany({
      where: {
        HotelName,
        fromYmd: { lte: to },
        toYmd: { gte: from },
        ...(exact ? { id: { not: exact.id } } : {}),
      },
      select: { id: true, fromYmd: true, toYmd: true },
    });
    if (overlapping.length) {
      const periodIds = overlapping.map((p) => p.id);
      const weeklyWhere = {
        periodId: { in: periodIds },
        wageType: "weekly",
      };
      if (idFilter.length) weeklyWhere.employeeId = { in: idFilter };
      const weeklyCount = await prisma.hr_payslip.count({
        where: weeklyWhere,
      });
      if (weeklyCount > 0) {
        throw new Error(
          `A weekly payroll already exists for an overlapping week (${from} → ${to}). Cannot generate another weekly run for the same week.`,
        );
      }
    }
  }
}

/** Active approved leave covering `ymd` (default today). */
async function employeeIdsOnLeave(db, scope, ymd = todayYmd()) {
  const rows = await db.hr_leave_request.findMany({
    where: {
      ...scope,
      status: "approved",
      fromYmd: { lte: ymd },
      toYmd: { gte: ymd },
    },
    select: { employeeId: true },
  });
  return new Set(rows.map((r) => r.employeeId));
}

function withEffectiveEmployeeStatus(employee, onLeaveIds) {
  if (!employee || employee.status === "terminated") return employee;
  const next = onLeaveIds.has(employee.id) ? "on_leave" : "active";
  return next === employee.status ? employee : { ...employee, status: next };
}

async function syncEmployeeLeaveStatus(db, employeeId) {
  const employee = await db.hr_employee.findUnique({
    where: { id: Number(employeeId) },
  });
  if (!employee || employee.status === "terminated") return employee;
  const today = todayYmd();
  const activeLeave = await db.hr_leave_request.findFirst({
    where: {
      employeeId: employee.id,
      status: "approved",
      fromYmd: { lte: today },
      toYmd: { gte: today },
    },
    select: { id: true },
  });
  const next = activeLeave ? "on_leave" : "active";
  if (employee.status === next) return employee;
  return db.hr_employee.update({
    where: { id: employee.id },
    data: { status: next },
  });
}

/** Upsert attendance rows as on_leave for each day of an approved leave. */
async function markAttendanceOnLeave(db, employee, fromYmd, toYmd) {
  const days = eachYmdInRange(fromYmd, toYmd);
  for (const workDate of days) {
    await db.hr_attendance.upsert({
      where: {
        employeeId_workDate: { employeeId: employee.id, workDate },
      },
      create: {
        HotelName: employee.HotelName,
        employeeId: employee.id,
        workDate,
        status: "on_leave",
        notes: "Approved leave",
      },
      update: {
        status: "on_leave",
        notes: "Approved leave",
        clockInAt: null,
        clockOutAt: null,
      },
    });
  }
}

function approvedLeaveCoversDate(leaves, employeeId, ymd) {
  return leaves.some(
    (l) =>
      l.employeeId === employeeId &&
      l.status === "approved" &&
      l.fromYmd <= ymd &&
      l.toYmd >= ymd,
  );
}

function periodKeyFromYmd(ymd) {
  return String(ymd || "").slice(0, 7);
}

function dayOfYmd(ymd) {
  return Number(String(ymd).slice(8, 10));
}

/**
 * Whether a common payroll line rule applies to a From–To window.
 * day_range: prefer calendar fromYmd/toYmd (overlap with pay window);
 * falls back to legacy day-of-month on endpoints.
 */
function lineRuleApplies(rule, fromYmd, toYmd) {
  if (rule?.active === false) return false;
  const mode = String(rule?.whenMode || "always").trim();
  if (mode !== "day_range") return true;

  const ruleFrom = String(rule.fromYmd || "").trim();
  const ruleTo = String(rule.toYmd || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(ruleFrom) && /^\d{4}-\d{2}-\d{2}$/.test(ruleTo)) {
    // Inclusive overlap with payroll [fromYmd, toYmd]
    return !(toYmd < ruleFrom || fromYmd > ruleTo);
  }

  const fd = Number(rule.fromDay);
  const td = Number(rule.toDay);
  if (!Number.isFinite(fd) || !Number.isFinite(td)) return true;
  const fromD = dayOfYmd(fromYmd);
  const toD = dayOfYmd(toYmd);
  const lo = Math.min(fd, td);
  const hi = Math.max(fd, td);
  return (
    (fromD >= lo && fromD <= hi) ||
    (toD >= lo && toD <= hi) ||
    (fromD <= lo && toD >= hi)
  );
}

/** Customized band: salary in [fromAmountETB, toAmountETB) — no upper if toAmount null. */
function lineRuleMatchesSalary(rule, salaryETB) {
  if (!rule?.customized) return true;
  const s = Number(salaryETB) || 0;
  const from = Number(rule.fromAmountETB) || 0;
  if (s < from) return false;
  if (rule.toAmountETB == null || rule.toAmountETB === "") return true;
  return s < Number(rule.toAmountETB);
}

function slugLeaveTypeCode(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * Shared payroll generate used by Manager-direct create and pending approval.
 */
async function runCreateHrPayrollPeriod(
  prisma,
  _context,
  {
    HotelName,
    actorName,
    fromYmd: from,
    toYmd: to,
    notes,
    employeeIds,
    wageScope,
  },
) {
  const named = namedMonthFromPayRange(from, to);
  const payDate = todayYmd();
  const rangeDays = inclusiveDayCount(from, to);

  await assertNoDuplicateWagePeriodPayroll(prisma, {
    HotelName,
    from,
    to,
    wageScope,
    employeeIds,
  });

  const existing = await prisma.hr_payroll_period.findUnique({
    where: {
      HotelName_fromYmd_toYmd: { HotelName, fromYmd: from, toYmd: to },
    },
  });
  if (existing) {
    const st = String(existing.status || "").trim();
    // Only pending_generate stubs can be replaced (HR re-submit before Manager approves).
    if (st === "pending_generate") {
      await prisma.hr_payslip.deleteMany({
        where: { periodId: existing.id },
      });
      await prisma.hr_payroll_period.delete({
        where: { id: existing.id },
      });
    } else {
      throw new Error(
        "A payroll run already exists for this From–To range. Choose different dates.",
      );
    }
  }

  const windows = await prisma.hr_wage_pay_window.findMany({
    where: { HotelName, active: true },
  });
  const windowByWage = new Map(
    windows.map((w) => [String(w.wageType), w]),
  );

  const idFilter = Array.isArray(employeeIds)
    ? employeeIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : [];

  let scope = String(wageScope ?? "").trim().toLowerCase();
  if (idFilter.length) scope = "employee";
  if (!scope) scope = "batch";
  if (!["batch", "monthly", "weekly", "employee"].includes(scope)) {
    throw new Error("Invalid wage scope");
  }

  const minGapForWages = (wageTypes) => {
    let minGap = 0;
    for (const wt of wageTypes) {
      const w = windowByWage.get(wt);
      if (!w) continue;
      const fd = Number(w.fromDay) || 0;
      if (fd > minGap) minGap = fd;
    }
    return minGap;
  };

  let targetWageTypes = [];
  if (scope === "batch") {
    targetWageTypes = ["monthly", "weekly"].filter((wt) =>
      windowByWage.has(wt),
    );
    if (!targetWageTypes.length) {
      throw new Error(
        "Configure wage-type pay windows (monthly and/or weekly) before batch generate",
      );
    }
  } else if (scope === "monthly" || scope === "weekly") {
    if (!windowByWage.has(scope)) {
      throw new Error(
        `Configure a ${scope} wage-type pay window in Payroll settings first`,
      );
    }
    targetWageTypes = [scope];
  }

  let employees;
  if (idFilter.length) {
    employees = await prisma.hr_employee.findMany({
      where: {
        HotelName,
        id: { in: idFilter },
        status: { in: ["active", "on_leave"] },
      },
      orderBy: { fullName: "asc" },
    });
    const empWages = [
      ...new Set(
        employees
          .map((e) => String(e.wageType || "").trim())
          .filter((wt) => WAGE_TYPES.has(wt)),
      ),
    ];
    const minGap = minGapForWages(empWages);
    if (minGap > 0 && rangeDays < minGap) {
      throw new Error(
        `From–To must cover at least ${minGap} day${minGap === 1 ? "" : "s"} for the selected employee wage type(s)`,
      );
    }
  } else {
    const minGap = minGapForWages(targetWageTypes);
    if (minGap > 0 && rangeDays < minGap) {
      throw new Error(
        `From–To must cover at least ${minGap} day${minGap === 1 ? "" : "s"} for ${scope === "batch" ? "batch (largest wage-window from-day)" : `${scope} wage window`}`,
      );
    }
    employees = await prisma.hr_employee.findMany({
      where: {
        HotelName,
        status: { in: ["active", "on_leave"] },
        wageType: { in: targetWageTypes },
      },
      orderBy: { fullName: "asc" },
    });
  }
  if (!employees.length) {
    throw new Error("No eligible employees for this payroll run");
  }

  const lineRules = await prisma.hr_payroll_line_rule.findMany({
    where: { HotelName, active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  const appliedRules = lineRules.filter((rule) =>
    lineRuleApplies(rule, from, to),
  );

  const employeeIdList = employees.map((e) => e.id);
  const [incidents, leaveRequests, leaveTypes, attendanceRows, incidentTypes] =
    await Promise.all([
      prisma.hr_incident.findMany({
        where: {
          HotelName,
          employeeId: { in: employeeIdList },
          occurredYmd: { gte: from, lte: to },
        },
      }),
      prisma.hr_leave_request.findMany({
        where: {
          HotelName,
          employeeId: { in: employeeIdList },
          status: "approved",
          fromYmd: { lte: to },
          toYmd: { gte: from },
        },
      }),
      prisma.hr_leave_type.findMany({ where: { HotelName } }),
      prisma.hr_attendance.findMany({
        where: {
          HotelName,
          employeeId: { in: employeeIdList },
          workDate: { gte: from, lte: to },
        },
      }),
      prisma.hr_incident_type.findMany({
        where: { HotelName, active: true },
      }),
    ]);

  const leaveTypesByCode = Object.fromEntries(
    leaveTypes.map((t) => [t.code, t]),
  );
  const leaveTypeLabels = Object.fromEntries(
    leaveTypes.map((t) => [t.code, t.label]),
  );
  const attendanceLinkedTypes = incidentTypes.filter(
    (t) =>
      String(t.attendanceLink || "").trim() &&
      (Number(t.percentOfSalary) > 0 || Number(t.amountETB) > 0),
  );

  const period = await prisma.$transaction(async (tx) => {
    const created = await tx.hr_payroll_period.create({
      data: {
        HotelName,
        periodKey: named.periodKey,
        monthName: named.monthName,
        fromYmd: from,
        toYmd: to,
        status: "open",
        notes: String(notes ?? "").trim(),
        createdBy: actorName,
      },
    });

    let seq = 1;
    for (const employee of employees) {
      const empIncidents = incidents.filter(
        (i) => Number(i.employeeId) === Number(employee.id),
      );
      const empLeaves = leaveRequests.filter(
        (l) => l.employeeId === employee.id,
      );
      const unpaidLeaves = empLeaves.filter((l) => {
        const type = leaveTypesByCode[l.leaveType];
        if (type) return type.paid === false;
        return String(l.leaveType).toLowerCase().includes("unpaid");
      });
      const leaveDates = new Set();
      for (const leave of empLeaves) {
        for (const ymd of eachYmdInRange(
          leave.fromYmd > from ? leave.fromYmd : from,
          leave.toYmd < to ? leave.toYmd : to,
        )) {
          leaveDates.add(ymd);
        }
      }
      const attendanceByDate = new Map();
      for (const row of attendanceRows) {
        if (row.employeeId !== employee.id) continue;
        if (leaveDates.has(row.workDate)) continue;
        attendanceByDate.set(row.workDate, row.status);
      }

      const employeeRules = appliedRules.filter((rule) =>
        lineRuleMatchesSalary(rule, Number(employee.baseSalaryETB) || 0),
      );

      const built = buildIntegratedPayLines({
        employee,
        fromYmd: from,
        toYmd: to,
        appliedRules: employeeRules,
        incidents: empIncidents,
        unpaidLeaves,
        leaveTypeLabels,
        attendanceByDate,
        leaveDates,
        attendanceLinkedTypes,
      });
      const number = payslipNumberFor(employee.id, created.id, seq++);
      const weeksNote =
        String(employee.wageType || "").trim() === "weekly" &&
        built.weeks
          ? `payrollWeeks=${built.weeks}`
          : "";

      await tx.hr_payslip.create({
        data: {
          HotelName,
          periodId: created.id,
          employeeId: employee.id,
          payslipNumber: number,
          employeeName: employee.fullName,
          jobTitle: employee.jobTitle || "",
          taxPeriod: named.monthName,
          organizationLocation: HotelName,
          payDate,
          hireDate: employee.hireDate || "",
          wageType: employee.wageType || "",
          bankName: employee.bankName || "",
          accountNumber: employee.accountNumber || "",
          basePayETB: built.gross,
          overtimeETB: 0,
          tipsETB: 0,
          deductionsETB: built.totalDeductionsETB,
          netPayETB: built.netPayETB,
          grossSalaryETB: built.gross,
          totalEarningsETB: built.totalEarningsETB,
          totalDeductionsETB: built.totalDeductionsETB,
          earningsJson: JSON.stringify(built.earnings),
          deductionsJson: JSON.stringify(built.deductions),
          paymentStatus: "unpaid",
          notes: weeksNote,
        },
      });
    }
    return created;
  });
  return period;
}

/**
 * @param {{
 *   prisma: import("@prisma/client").PrismaClient,
 *   tenantScopeFromContext: Function,
 *   tenantHotelReadWhere: Function,
 *   tenantHotelReadMatches: Function,
 *   assertRole: Function,
 *   assertAdminOrManager: Function,
 *   assertAuthenticated: Function,
 * }} deps
 */
export function createHrResolvers({
  prisma,
  tenantScopeFromContext,
  tenantHotelReadWhere,
  tenantHotelReadMatches,
  assertRole,
  assertAdminOrManager,
  assertAuthenticated,
}) {
  const assertHrStaff = (context) => assertRole(context, HR_STAFF_ROLES);
  const assertLeaveManager = (context) =>
    assertRole(context, HR_LEAVE_MANAGER_ROLES);
  const assertPayrollRunner = (context) =>
    assertRole(context, ["HR", "Admin"]);
  const assertHrAccess = assertHrStaff;

  async function loadTenantModules(context) {
    const tin = requireTenant(context, tenantScopeFromContext);
    const acct = await prisma.tenant_account.findUnique({
      where: { tinNumber: tin },
      select: { modules: true },
    });
    return parseModulesJson(acct?.modules);
  }

  async function assertTenantHrFinance(context) {
    const mods = await loadTenantModules(context);
    const set = new Set(mods.map((m) => String(m)));
    if (!set.has("HR Module") || !set.has("Financial Management")) {
      throw new Error(
        "HR finance requires HR Module and Financial Management",
      );
    }
  }

  /** HR/Admin only — sends payslips to Finance for mark-paid confirmation. */
  async function assertCanMarkPayslipsPaid(context) {
    const { actorRole } = actorFromContext(context);
    if (actorRole === "HR" || actorRole === "Admin") return;
    throw new Error("Only HR can mark payslips paid (Finance then confirms)");
  }

  /** Finance (HR+Fin modules) or Admin — confirm or reject mark-paid. */
  async function assertCanDecidePayslipPayment(context) {
    const { actorRole } = actorFromContext(context);
    if (actorRole === "Admin") return;
    if (actorRole === "Finance") {
      await assertTenantHrFinance(context);
      return;
    }
    throw new Error("Not authorized to approve payslip payment");
  }

  /** Staff HR + Manager; Finance for payroll read when HR+Fin. */
  async function assertHrOrFinancePayrollRead(context) {
    const { actorRole } = actorFromContext(context);
    if (HR_STAFF_ROLES.includes(actorRole)) return;
    if (actorRole === "Finance") {
      await assertTenantHrFinance(context);
      return;
    }
    assertHrStaff(context);
  }

  function pendingManagerApprovalError(message) {
    const err = new Error(message);
    err.extensions = { code: "PENDING_MANAGER_APPROVAL" };
    return err;
  }

  async function loadEmployeeOrThrow(id) {
    const employee = await prisma.hr_employee.findUnique({
      where: { id: Number(id) },
    });
    if (!employee) throw new Error("Employee not found");
    return employee;
  }

  async function loadEmployeeInTenantOrThrow(context, id) {
    const employee = await loadEmployeeOrThrow(id);
    if (!tenantHotelReadMatches(context, employee.HotelName)) {
      throw new Error("Employee not found");
    }
    return employee;
  }

  function parsePayLines(raw) {
    try {
      const parsed = JSON.parse(String(raw || "[]"));
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((row) => ({
          label: String(row?.label ?? "").trim(),
          amountETB: round2(Number(row?.amountETB) || 0),
        }))
        .filter((row) => row.label);
    } catch {
      return [];
    }
  }

  return {
    HrPayslip: {
      earnings: (row) => parsePayLines(row.earningsJson),
      deductions: (row) => parsePayLines(row.deductionsJson),
    },

    HrEmployee: {
      portalOtpPreview: (row, _, context) =>
        visiblePortalOtpPreview(row, context),
      portalOtpHash: () => "",
    },

    HrLeaveRequest: {
      currentStepKind: async (row, _, context) => {
        try {
          if (String(row?.status || "") !== "pending") return "";
          let flow = null;
          if (row.flowId != null) {
            flow = await prisma.hr_approval_flow.findUnique({
              where: { id: Number(row.flowId) },
            });
          }
          const employee =
            row.employee ||
            (row.employeeId != null
              ? await prisma.hr_employee.findUnique({
                  where: { id: Number(row.employeeId) },
                  select: { teamId: true },
                })
              : null);
          const steps = effectiveSteps(
            flow || {
              requireTeamLeaderFirst: true,
              stepsJson: defaultSteps({
                businessType: String(context?.user?.businessType || ""),
              }),
            },
            { hasTeam: Boolean(employee?.teamId) },
          );
          const idx = Number(row.currentStepIndex) || 0;
          return String(steps[idx]?.kind || "");
        } catch {
          return "";
        }
      },
    },

    Query: {
      hrEmployees: async (_, __, context) => {
        assertHrAccess(context);
        const where = tenantHotelReadWhere(context);
        const employees = await prisma.hr_employee.findMany({
          where,
          orderBy: [{ status: "asc" }, { fullName: "asc" }],
        });
        const onLeaveIds = await employeeIdsOnLeave(prisma, where);
        return employees.map((e) => withEffectiveEmployeeStatus(e, onLeaveIds));
      },

      hrEmployee: async (_, { id }, context) => {
        assertHrAccess(context);
        const employee = await prisma.hr_employee.findUnique({
          where: { id: Number(id) },
        });
        if (!employee || !tenantHotelReadMatches(context, employee.HotelName)) {
          return null;
        }
        const onLeaveIds = await employeeIdsOnLeave(prisma, {
          HotelName: employee.HotelName,
        });
        return withEffectiveEmployeeStatus(employee, onLeaveIds);
      },

      hrEmployeeMe: async (_, __, context) => {
        assertHrAccess(context);
        return null;
      },

      hrLeaveTypes: async (_, __, context) => {
        assertHrAccess(context);
        return prisma.hr_leave_type.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        });
      },

      hrDepartments: async (_, __, context) => {
        assertHrAccess(context);
        return prisma.hr_department.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        });
      },

      hrTeams: async (_, { departmentId }, context) => {
        assertHrAccess(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (departmentId != null) where.departmentId = Number(departmentId);
        return prisma.hr_team.findMany({
          where,
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        });
      },

      hrApprovalFlows: async (_, { requestType }, context) => {
        assertLeaveManager(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (requestType != null && String(requestType).trim()) {
          where.requestType = String(requestType).trim();
        }
        return prisma.hr_approval_flow.findMany({
          where,
          orderBy: [{ requestType: "asc" }, { id: "asc" }],
        });
      },

      hrIncidentTypes: async (_, __, context) => {
        assertHrAccess(context);
        return prisma.hr_incident_type.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        });
      },

      hrLeaveRequests: async (_, { status }, context) => {
        assertHrAccess(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (status != null && String(status).trim() !== "") {
          const s = String(status).trim();
          if (!LEAVE_STATUSES.has(s)) throw new Error("Invalid leave status");
          where.status = s;
        }
        return prisma.hr_leave_request.findMany({
          where,
          include: { employee: true },
          orderBy: { createdAt: "desc" },
        });
      },

      hrLeaveBalances: async (_, { employeeId }, context) => {
        assertHrAccess(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (employeeId != null) {
          where.employeeId = Number(employeeId);
        }
        return prisma.hr_leave_balance.findMany({
          where,
          include: { employee: true },
          orderBy: [{ employeeId: "asc" }, { leaveType: "asc" }],
        });
      },

      hrAttendance: async (_, { fromYmd, toYmd, employeeId }, context) => {
        assertHrAccess(context);
        const where = {
          ...tenantHotelReadWhere(context),
        };
        const fromRaw = fromYmd != null ? String(fromYmd).trim() : "";
        const toRaw = toYmd != null ? String(toYmd).trim() : "";
        let from = "";
        let to = "";
        if (fromRaw && toRaw) {
          from = assertYmd(fromRaw, "fromYmd");
          to = assertYmd(toRaw, "toYmd");
          where.workDate = { gte: from, lte: to };
        }
        if (employeeId != null) where.employeeId = Number(employeeId);
        const rows = await prisma.hr_attendance.findMany({
          where,
          include: { employee: true },
          orderBy: [{ workDate: "desc" }, { employeeId: "asc" }],
        });
        const leaveWhere = { ...tenantHotelReadWhere(context), status: "approved" };
        if (from && to) {
          leaveWhere.fromYmd = { lte: to };
          leaveWhere.toYmd = { gte: from };
        }
        if (employeeId != null) leaveWhere.employeeId = Number(employeeId);
        const leaves = await prisma.hr_leave_request.findMany({
          where: leaveWhere,
          select: {
            employeeId: true,
            fromYmd: true,
            toYmd: true,
            status: true,
          },
        });
        return rows.map((row) => {
          if (approvedLeaveCoversDate(leaves, row.employeeId, row.workDate)) {
            return {
              ...row,
              status: "on_leave",
              notes: row.notes?.includes("leave")
                ? row.notes
                : row.notes
                  ? `${row.notes} · Approved leave`
                  : "Approved leave",
            };
          }
          return row;
        });
      },

      hrShifts: async (_, { fromYmd, toYmd, employeeId }, context) => {
        assertHrAccess(context);
        const where = {
          ...tenantHotelReadWhere(context),
        };
        const fromRaw = fromYmd != null ? String(fromYmd).trim() : "";
        const toRaw = toYmd != null ? String(toYmd).trim() : "";
        if (fromRaw && toRaw) {
          const from = assertYmd(fromRaw, "fromYmd");
          const to = assertYmd(toRaw, "toYmd");
          where.workDate = { gte: from, lte: to };
        }
        if (employeeId != null) where.employeeId = Number(employeeId);
        return prisma.hr_shift.findMany({
          where,
          include: { employee: true },
          orderBy: [{ workDate: "asc" }, { startTime: "asc" }],
        });
      },

      hrDocuments: async (_, { employeeId }, context) => {
        assertHrAccess(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (employeeId != null) where.employeeId = Number(employeeId);
        return prisma.hr_document.findMany({
          where,
          include: { employee: true },
          orderBy: { createdAt: "desc" },
        });
      },

      hrPayrollPeriods: async (_, __, context) => {
        await assertHrOrFinancePayrollRead(context);
        return prisma.hr_payroll_period.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: [{ fromYmd: "desc" }, { id: "desc" }],
        });
      },

      hrPayslips: async (_, { periodId, paymentStatus }, context) => {
        await assertHrOrFinancePayrollRead(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (periodId != null) {
          const period = await prisma.hr_payroll_period.findUnique({
            where: { id: Number(periodId) },
          });
          if (!period || !tenantHotelReadMatches(context, period.HotelName)) {
            throw new Error("Payroll period not found");
          }
          where.periodId = period.id;
        }
        if (paymentStatus != null && String(paymentStatus).trim() !== "") {
          const ps = String(paymentStatus).trim();
          if (!PAYSLIP_PAYMENT_STATUSES.has(ps)) {
            throw new Error("Invalid payment status");
          }
          where.paymentStatus = ps;
        }
        return prisma.hr_payslip.findMany({
          where,
          include: { employee: true, period: true },
          orderBy: [{ periodId: "desc" }, { employeeId: "asc" }],
        });
      },

      hrPayrollLineRules: async (_, __, context) => {
        assertHrAccess(context);
        return prisma.hr_payroll_line_rule.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
        });
      },

      hrWagePayWindows: async (_, __, context) => {
        assertHrAccess(context);
        return prisma.hr_wage_pay_window.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: { wageType: "asc" },
        });
      },

      hrIncidents: async (_, { employeeId }, context) => {
        assertHrAccess(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (employeeId != null) where.employeeId = Number(employeeId);
        return prisma.hr_incident.findMany({
          where,
          include: { employee: true },
          orderBy: { createdAt: "desc" },
        });
      },

      hrDashboardStats: async (_, __, context) => {
        assertHrAccess(context);
        const scope = tenantHotelReadWhere(context);
        const today = todayYmd();
        const [
          headcount,
          onLeaveRows,
          pendingLeave,
          openShiftsToday,
          openPayrollPeriods,
        ] = await Promise.all([
          prisma.hr_employee.count({
            where: { ...scope, status: { in: ["active", "on_leave"] } },
          }),
          prisma.hr_leave_request.findMany({
            where: {
              ...scope,
              status: "approved",
              fromYmd: { lte: today },
              toYmd: { gte: today },
            },
            select: { employeeId: true },
            distinct: ["employeeId"],
          }),
          prisma.hr_leave_request.count({
            where: { ...scope, status: "pending" },
          }),
          prisma.hr_shift.count({
            where: { ...scope, workDate: today },
          }),
          prisma.hr_payroll_period.count({
            where: { ...scope, status: "open" },
          }),
        ]);
        return {
          headcount,
          onLeaveToday: onLeaveRows.length,
          pendingLeave,
          openShiftsToday,
          openPayrollPeriods,
        };
      },

      hrNotifications: async (_, { unreadOnly }, context) => {
        assertHrAccess(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorRole } = actorFromContext(context);
        return listHrNotificationsForActor(prisma, {
          HotelName,
          role: actorRole,
          unreadOnly: Boolean(unreadOnly),
        });
      },

      hrOtpResetRequests: async (_, { status }, context) => {
        assertHrAccess(context);
        const where = {
          ...tenantHotelReadWhere(context),
        };
        if (status != null && String(status).trim()) {
          where.status = String(status).trim();
        }
        return prisma.hr_otp_reset_request.findMany({
          where,
          include: { employee: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
      },

      hrManagerPendingActions: async (_, { status }, context) => {
        assertLeaveManager(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (status != null && String(status).trim()) {
          where.status = String(status).trim();
        }
        return prisma.hr_manager_pending_action.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
      },
    },

    Mutation: {
      createHrEmployee: async (
        _,
        {
          fullName,
          phone,
          email,
          department,
          jobTitle,
          orgPosition,
          teamId,
          hireDate,
          wageType,
          baseSalaryETB,
          bankName,
          accountNumber,
          notes,
          gender,
          education,
          personalTin,
          medicalNote,
        },
        context,
      ) => {
        assertHrAccess(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const name = String(fullName ?? "").trim();
        if (!name) throw new Error("Employee full name is required");
        let wt = String(wageType ?? "monthly").trim();
        if (!WAGE_TYPES.has(wt)) wt = "monthly";
        const hd =
          hireDate != null && String(hireDate).trim() !== ""
            ? assertYmd(hireDate, "hireDate")
            : "";
        let pos = String(orgPosition ?? "employee").trim().toLowerCase();
        if (!ORG_POSITIONS.has(pos)) pos = "employee";
        let tid =
          teamId != null && Number(teamId) > 0 ? Number(teamId) : null;
        if (tid) {
          const team = await prisma.hr_team.findFirst({
            where: { id: tid, HotelName },
          });
          if (!team) throw new Error("Team not found");
        }

        const employee = await prisma.hr_employee.create({
          data: {
            HotelName,
            fullName: name,
            phone: String(phone ?? "").trim(),
            email: String(email ?? "").trim(),
            department: String(department ?? "").trim(),
            jobTitle: String(jobTitle ?? "").trim(),
            orgPosition: pos,
            teamId: tid,
            status: "active",
            hireDate: hd,
            wageType: wt,
            baseSalaryETB: round2(Number(baseSalaryETB) || 0),
            bankName: String(bankName ?? "").trim(),
            accountNumber: String(accountNumber ?? "").trim(),
            credentialUserId: null,
            credentialUserName: "",
            notes: String(notes ?? "").trim(),
            gender: String(gender ?? "").trim(),
            education: String(education ?? "").trim(),
            personalTin: String(personalTin ?? "").trim(),
            medicalNote: String(medicalNote ?? "").trim(),
          },
        });

        const leaveTypes = await prisma.hr_leave_type.findMany({
          where: { HotelName, active: true, paid: true },
        });
        if (leaveTypes.length) {
          await prisma.hr_leave_balance.createMany({
            data: leaveTypes.map((type) => ({
              HotelName,
              employeeId: employee.id,
              leaveType: type.code,
              balanceDays: round2(Number(type.defaultDays) || 0),
            })),
            skipDuplicates: true,
          });
        }
        return employee;
      },

      updateHrEmployee: async (
        _,
        {
          id,
          fullName,
          phone,
          email,
          department,
          jobTitle,
          orgPosition,
          teamId,
          status,
          hireDate,
          wageType,
          baseSalaryETB,
          bankName,
          accountNumber,
          credentialUserId,
          credentialUserName,
          notes,
          gender,
          education,
          personalTin,
          medicalNote,
        },
        context,
      ) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, id);
        const data = {};
        if (fullName != null) {
          const name = String(fullName).trim();
          if (!name) throw new Error("Employee full name is required");
          data.fullName = name;
        }
        if (phone != null) data.phone = String(phone).trim();
        if (email != null) data.email = String(email).trim();
        if (department != null) data.department = String(department).trim();
        if (jobTitle != null) data.jobTitle = String(jobTitle).trim();
        if (orgPosition != null) {
          const pos = String(orgPosition).trim().toLowerCase();
          if (!ORG_POSITIONS.has(pos)) throw new Error("Invalid org position");
          data.orgPosition = pos;
        }
        if (teamId !== undefined) {
          if (teamId == null || Number(teamId) <= 0) {
            data.teamId = null;
          } else {
            const team = await prisma.hr_team.findFirst({
              where: { id: Number(teamId), HotelName: employee.HotelName },
            });
            if (!team) throw new Error("Team not found");
            data.teamId = team.id;
          }
        }
        if (status != null) {
          const s = String(status).trim();
          if (!EMPLOYEE_STATUSES.has(s)) throw new Error("Invalid employee status");
          data.status = s;
        }
        if (hireDate != null) {
          data.hireDate =
            String(hireDate).trim() !== ""
              ? assertYmd(hireDate, "hireDate")
              : "";
        }
        if (wageType != null) {
          const wt = String(wageType).trim();
          if (!WAGE_TYPES.has(wt)) throw new Error("Invalid wage type");
          data.wageType = wt;
        }
        if (baseSalaryETB != null) {
          data.baseSalaryETB = round2(Number(baseSalaryETB) || 0);
        }
        if (bankName != null) data.bankName = String(bankName).trim();
        if (accountNumber != null) {
          data.accountNumber = String(accountNumber).trim();
        }
        if (credentialUserId !== undefined) {
          data.credentialUserId =
            credentialUserId != null ? Number(credentialUserId) : null;
        }
        if (credentialUserName != null) {
          data.credentialUserName = String(credentialUserName).trim();
        }
        if (notes != null) data.notes = String(notes).trim();
        if (gender != null) data.gender = String(gender).trim();
        if (education != null) data.education = String(education).trim();
        if (personalTin != null) data.personalTin = String(personalTin).trim();
        if (medicalNote != null) data.medicalNote = String(medicalNote).trim();
        if (credentialUserName != null) {
          data.credentialUserName = String(credentialUserName).trim();
        }
        if (notes != null) data.notes = String(notes).trim();
        const updated = await prisma.hr_employee.update({
          where: { id: employee.id },
          data,
        });
        const onLeaveIds = await employeeIdsOnLeave(prisma, {
          HotelName: updated.HotelName,
        });
        return withEffectiveEmployeeStatus(updated, onLeaveIds);
      },

      terminateHrEmployee: async (_, { id, endDate }, context) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, id);
        const { actorRole, actorName } = actorFromContext(context);
        const ed =
          endDate != null && String(endDate).trim() !== ""
            ? assertYmd(endDate, "endDate")
            : todayYmd();

        if (!isDeskManagerOrAdmin(actorRole)) {
          await createManagerPendingAction(prisma, {
            HotelName: employee.HotelName,
            kind: "terminate",
            employeeId: employee.id,
            payloadJson: { endDate: ed },
            requestedBy: actorName,
          });
          await createHrNotification(prisma, {
            HotelName: employee.HotelName,
            recipientRole: "Manager",
            kind: "manager_pending_terminate",
            title: "Terminate employee awaiting approval",
            body: `${actorName || "HR"} requested termination of ${employee.fullName}.`,
            href: "manager-pending",
            actionStatus: "pending",
            createdBy: actorName,
          });
          throw pendingManagerApprovalError(
            "Termination submitted for Manager approval.",
          );
        }

        return prisma.hr_employee.update({
          where: { id: employee.id },
          data: {
            status: "terminated",
            endDate: ed,
            ...clearPortalOtpLoginFields(),
          },
        });
      },

      deleteHrEmployee: async (_, { id }, context) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, id);
        const eid = employee.id;
        await prisma.$transaction(async (tx) => {
          await tx.hr_notification.deleteMany({
            where: { HotelName: employee.HotelName, employeeId: eid },
          });
          await tx.hr_manager_pending_action.deleteMany({
            where: { HotelName: employee.HotelName, employeeId: eid },
          });
          await tx.hr_chat_member.deleteMany({ where: { employeeId: eid } });
          await tx.hr_chat_message.updateMany({
            where: { senderEmployeeId: eid },
            data: { senderEmployeeId: null },
          });
          await tx.hr_chat_block.deleteMany({
            where: {
              HotelName: employee.HotelName,
              OR: [{ employeeIdA: eid }, { employeeIdB: eid }],
            },
          });
          await tx.hr_chat_thread.updateMany({
            where: {
              HotelName: employee.HotelName,
              createdByEmployeeId: eid,
            },
            data: { createdByEmployeeId: null },
          });
          await tx.hr_employee.delete({ where: { id: eid } });
        });
        return true;
      },

      replaceHrLeaveTypes: async (_, { types }, context) => {
        assertLeaveManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const incoming = Array.isArray(types) ? types : [];
        const seen = new Set();
        const rows = [];
        incoming.forEach((row, index) => {
          const label = String(row?.label ?? "").trim();
          if (!label) return;
          let code = slugLeaveTypeCode(row?.code || label);
          if (!code) return;
          let unique = code;
          let n = 2;
          while (seen.has(unique)) unique = `${code}_${n++}`;
          seen.add(unique);
          rows.push({
            code: unique,
            label,
            paid: row?.paid !== false,
            defaultDays: round2(Number(row?.defaultDays) || 0),
            active: row?.active !== false,
            sortOrder: index,
          });
        });

        await prisma.$transaction(async (tx) => {
          const existing = await tx.hr_leave_type.findMany({
            where: { HotelName },
          });
          const keep = new Set(rows.map((r) => r.code));
          const toDelete = existing.filter((row) => !keep.has(row.code));
          if (toDelete.length) {
            await tx.hr_leave_type.deleteMany({
              where: { id: { in: toDelete.map((row) => row.id) } },
            });
          }
          for (const row of rows) {
            await tx.hr_leave_type.upsert({
              where: {
                HotelName_code: { HotelName, code: row.code },
              },
              create: { HotelName, ...row },
              update: {
                label: row.label,
                paid: row.paid,
                defaultDays: row.defaultDays,
                active: row.active,
                sortOrder: row.sortOrder,
              },
            });
          }
        });

        return prisma.hr_leave_type.findMany({
          where: { HotelName },
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        });
      },

      replaceHrDepartments: async (_, { departments }, context) => {
        assertLeaveManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const incoming = Array.isArray(departments) ? departments : [];
        const seen = new Set();
        const rows = [];
        incoming.forEach((row, index) => {
          const label = String(row?.label ?? "").trim();
          if (!label) return;
          let code = slugLeaveTypeCode(row?.code || label);
          if (!code) return;
          let unique = code;
          let n = 2;
          while (seen.has(unique)) unique = `${code}_${n++}`;
          seen.add(unique);
          rows.push({
            code: unique,
            label,
            active: row?.active !== false,
            sortOrder: index,
          });
        });

        await prisma.$transaction(async (tx) => {
          const existing = await tx.hr_department.findMany({
            where: { HotelName },
          });
          const keep = new Set(rows.map((r) => r.code));
          const toDelete = existing.filter((row) => !keep.has(row.code));
          if (toDelete.length) {
            await tx.hr_department.deleteMany({
              where: { id: { in: toDelete.map((row) => row.id) } },
            });
          }
          for (const row of rows) {
            await tx.hr_department.upsert({
              where: {
                HotelName_code: { HotelName, code: row.code },
              },
              create: { HotelName, ...row },
              update: {
                label: row.label,
                active: row.active,
                sortOrder: row.sortOrder,
              },
            });
          }
        });

        return prisma.hr_department.findMany({
          where: { HotelName },
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        });
      },

      replaceHrIncidentTypes: async (_, { types }, context) => {
        assertLeaveManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const incoming = Array.isArray(types) ? types : [];
        const seen = new Set();
        const rows = [];
        incoming.forEach((row, index) => {
          const label = String(row?.label ?? "").trim();
          if (!label) return;
          let code = slugLeaveTypeCode(row?.code || label);
          if (!code) return;
          let unique = code;
          let n = 2;
          while (seen.has(unique)) unique = `${code}_${n++}`;
          seen.add(unique);
          rows.push({
            code: unique,
            label,
            deduct: Boolean(row?.deduct),
            percentOfSalary: Math.max(
              0,
              Math.min(100, round2(Number(row?.percentOfSalary) || 0)),
            ),
            amountETB: 0,
            attendanceLink: (() => {
              const link = String(row?.attendanceLink ?? "").trim();
              return ATTENDANCE_LINK_VALUES.has(link) ? link : "";
            })(),
            active: row?.active !== false,
            sortOrder: index,
          });
        });

        await prisma.$transaction(async (tx) => {
          const existing = await tx.hr_incident_type.findMany({
            where: { HotelName },
          });
          const keep = new Set(rows.map((r) => r.code));
          const toDelete = existing.filter((row) => !keep.has(row.code));
          if (toDelete.length) {
            await tx.hr_incident_type.deleteMany({
              where: { id: { in: toDelete.map((row) => row.id) } },
            });
          }
          for (const row of rows) {
            await tx.hr_incident_type.upsert({
              where: {
                HotelName_code: { HotelName, code: row.code },
              },
              create: { HotelName, ...row },
              update: {
                label: row.label,
                deduct: row.deduct,
                percentOfSalary: row.percentOfSalary,
                amountETB: row.amountETB,
                attendanceLink: row.attendanceLink,
                active: row.active,
                sortOrder: row.sortOrder,
              },
            });
          }
        });

        return prisma.hr_incident_type.findMany({
          where: { HotelName },
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        });
      },

      upsertHrTeam: async (
        _,
        { id, departmentId, code, label, active, sortOrder },
        context,
      ) => {
        assertLeaveManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const dept = await prisma.hr_department.findFirst({
          where: { id: Number(departmentId), HotelName },
        });
        if (!dept) throw new Error("Department not found");
        const c = String(code ?? "").trim();
        const lab = String(label ?? "").trim();
        if (!c || !lab) throw new Error("Team code and label are required");
        const data = {
          HotelName,
          departmentId: dept.id,
          code: c,
          label: lab,
          active: active == null ? true : Boolean(active),
          sortOrder: sortOrder == null ? 0 : Number(sortOrder) || 0,
        };
        if (id != null && Number(id) > 0) {
          const existing = await prisma.hr_team.findFirst({
            where: { id: Number(id), HotelName },
          });
          if (!existing) throw new Error("Team not found");
          return prisma.hr_team.update({ where: { id: existing.id }, data });
        }
        return prisma.hr_team.create({ data });
      },

      deleteHrTeam: async (_, { id }, context) => {
        assertLeaveManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const existing = await prisma.hr_team.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!existing) throw new Error("Team not found");
        await prisma.hr_employee.updateMany({
          where: { teamId: existing.id },
          data: { teamId: null },
        });
        await prisma.hr_team.delete({ where: { id: existing.id } });
        return true;
      },

      upsertHrApprovalFlow: async (
        _,
        {
          id,
          requestType,
          departmentId,
          requireTeamLeaderFirst,
          stepsJson,
          active,
        },
        context,
      ) => {
        assertLeaveManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const rt = String(requestType ?? "").trim();
        if (!rt) throw new Error("requestType is required");
        const steps = normalizeSteps(stepsJson);
        if (!steps.length) throw new Error("At least one approval step is required");
        let deptId = null;
        if (departmentId != null && Number(departmentId) > 0) {
          const dept = await prisma.hr_department.findFirst({
            where: { id: Number(departmentId), HotelName },
          });
          if (!dept) throw new Error("Department not found");
          deptId = dept.id;
        }
        const data = {
          HotelName,
          requestType: rt,
          departmentId: deptId,
          requireTeamLeaderFirst:
            requireTeamLeaderFirst == null ? true : Boolean(requireTeamLeaderFirst),
          stepsJson: steps,
          active: active == null ? true : Boolean(active),
        };
        if (id != null && Number(id) > 0) {
          const existing = await prisma.hr_approval_flow.findFirst({
            where: { id: Number(id), HotelName },
          });
          if (!existing) throw new Error("Approval flow not found");
          return prisma.hr_approval_flow.update({
            where: { id: existing.id },
            data,
          });
        }
        return prisma.hr_approval_flow.create({ data });
      },

      deleteHrApprovalFlow: async (_, { id }, context) => {
        assertLeaveManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const existing = await prisma.hr_approval_flow.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!existing) throw new Error("Approval flow not found");
        await prisma.hr_approval_flow.delete({ where: { id: existing.id } });
        return true;
      },

      upsertHrLeaveBalance: async (
        _,
        { employeeId, leaveType, balanceDays },
        context,
      ) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, employeeId);
        const lt = String(leaveType ?? "").trim();
        if (!lt) throw new Error("Leave type is required");
        return prisma.hr_leave_balance.upsert({
          where: {
            employeeId_leaveType: { employeeId: employee.id, leaveType: lt },
          },
          create: {
            HotelName: employee.HotelName,
            employeeId: employee.id,
            leaveType: lt,
            balanceDays: round2(Number(balanceDays) || 0),
          },
          update: { balanceDays: round2(Number(balanceDays) || 0) },
        });
      },

      createHrLeaveRequest: async (
        _,
        { employeeId, leaveType, fromYmd, toYmd, days, reason },
        context,
      ) => {
        assertHrAccess(context);
        const targetId = Number(employeeId);
        const employee = await loadEmployeeInTenantOrThrow(context, targetId);
        await assertEmployeeCanRequestLeave(prisma, employee);
        const lt = String(leaveType ?? "").trim();
        if (!lt) throw new Error("Leave type is required");
        const typeRow = await prisma.hr_leave_type.findFirst({
          where: { HotelName: employee.HotelName, code: lt, active: true },
        });
        if (!typeRow) throw new Error("Invalid or inactive leave type");
        const from = assertYmd(fromYmd, "fromYmd");
        const to = assertYmd(toYmd, "toYmd");
        if (to < from) throw new Error("toYmd must not be before fromYmd");
        const d = days != null ? Number(days) : 1;
        if (!(d > 0)) throw new Error("days must be positive");
        if (typeRow.paid) {
          const balance = await prisma.hr_leave_balance.findUnique({
            where: {
              employeeId_leaveType: {
                employeeId: employee.id,
                leaveType: lt,
              },
            },
          });
          const available = round2(
            balance
              ? Number(balance.balanceDays)
              : Number(typeRow.defaultDays) || 0,
          );
          if (d > available) {
            throw new Error(
              `Only ${available} ${typeRow.label} day(s) remaining`,
            );
          }
        }

        const businessType = String(context?.user?.businessType || "").trim();
        const account = await prisma.tenant_account.findFirst({
          where: {
            OR: [
              { hotelDisplayName: employee.HotelName },
              { tinNumber: employee.HotelName },
            ],
          },
          select: { hrSoloManagerEnabled: true },
        });
        const prep = await prepareLeaveFlowAttachment(prisma, {
          employee,
          businessType,
          hrSoloManagerEnabled: Boolean(account?.hrSoloManagerEnabled),
        });

        const created = await prisma.hr_leave_request.create({
          data: {
            HotelName: employee.HotelName,
            employeeId: employee.id,
            leaveType: lt,
            fromYmd: from,
            toYmd: to,
            days: round2(d),
            reason: String(reason ?? "").trim(),
            status: "pending",
            flowId: prep.flowId,
            currentStepIndex: prep.currentStepIndex,
          },
          include: { employee: true },
        });
        await recordEscalations(prisma, {
          HotelName: employee.HotelName,
          requestId: created.id,
          steps: prep.steps,
          escalatedKinds: prep.escalatedKinds,
        });

        const step = prep.steps[prep.currentStepIndex] || { kind: "manager" };
        const assignees = await resolveAssignees(prisma, {
          HotelName: employee.HotelName,
          kind: step.kind,
          employee,
        });
        for (const role of assignees.roles) {
          await createHrNotification(prisma, {
            HotelName: employee.HotelName,
            recipientRole: role,
            kind: "leave_pending",
            title: "Leave needs approval",
            body: `${employee.fullName} requested ${lt} leave (${from} → ${to}).`,
            href: `/HR?section=leave`,
            actionStatus: "pending",
            createdBy: actorFromContext(context).actorName,
          });
        }
        for (const eid of assignees.employeeIds) {
          await createHrNotification(prisma, {
            HotelName: employee.HotelName,
            employeeId: eid,
            kind: "leave_pending",
            title: "Leave needs your approval",
            body: `${employee.fullName} requested ${lt} leave (${from} → ${to}).`,
            href: `/approvals`,
            actionStatus: "pending",
            createdBy: actorFromContext(context).actorName,
          });
        }
        return created;
      },

      decideHrLeaveRequest: async (_, { id, approve, note }, context) => {
        assertHrAccess(context);
        const request = await prisma.hr_leave_request.findUnique({
          where: { id: Number(id) },
          include: { employee: true },
        });
        if (!request || !tenantHotelReadMatches(context, request.HotelName)) {
          throw new Error("Leave request not found");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const updated = await decideLeaveOnEngine(prisma, {
          leave: request,
          approve: Boolean(approve),
          actor: { role: actorRole, name: actorName },
          note,
          onFinalApprove: async (leave) => {
            await prisma.$transaction(async (tx) => {
              const typeRow = await tx.hr_leave_type.findFirst({
                where: {
                  HotelName: leave.HotelName,
                  code: leave.leaveType,
                },
              });
              const deductPaid = typeRow
                ? Boolean(typeRow.paid)
                : ["annual", "sick"].includes(leave.leaveType);
              if (deductPaid) {
                const balance = await tx.hr_leave_balance.findUnique({
                  where: {
                    employeeId_leaveType: {
                      employeeId: leave.employeeId,
                      leaveType: leave.leaveType,
                    },
                  },
                });
                const nextBalance = round2(
                  (balance ? Number(balance.balanceDays) : 0) -
                    Number(leave.days),
                );
                await tx.hr_leave_balance.upsert({
                  where: {
                    employeeId_leaveType: {
                      employeeId: leave.employeeId,
                      leaveType: leave.leaveType,
                    },
                  },
                  create: {
                    HotelName: leave.HotelName,
                    employeeId: leave.employeeId,
                    leaveType: leave.leaveType,
                    balanceDays: nextBalance,
                  },
                  update: { balanceDays: nextBalance },
                });
              }
              await syncEmployeeLeaveStatus(tx, leave.employeeId);
              await markAttendanceOnLeave(
                tx,
                leave.employee,
                leave.fromYmd,
                leave.toYmd,
              );
            });
          },
        });
        if (updated.status === "rejected") {
          await syncEmployeeLeaveStatus(prisma, updated.employeeId);
        }
        if (
          updated.status === "approved" ||
          updated.status === "rejected"
        ) {
          await notifyEmployeeLeaveDecision(prisma, updated, {
            createdBy: actorName,
          });
        }
        return updated;
      },

      clockHrAttendance: async (_, { employeeId, action }, context) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, employeeId);
        const act = String(action ?? "").trim().toLowerCase();
        if (act !== "in" && act !== "out") {
          throw new Error("action must be 'in' or 'out'");
        }
        const workDate = todayYmd();
        const onLeaveToday = await prisma.hr_leave_request.findFirst({
          where: {
            employeeId: employee.id,
            status: "approved",
            fromYmd: { lte: workDate },
            toYmd: { gte: workDate },
          },
          select: { id: true },
        });
        if (onLeaveToday) {
          throw new Error(
            "Employee is on approved leave today — mark attendance as on leave, not clock in/out",
          );
        }
        const now = new Date();
        const existing = await prisma.hr_attendance.findUnique({
          where: {
            employeeId_workDate: { employeeId: employee.id, workDate },
          },
        });

        if (act === "in") {
          if (existing?.clockInAt) {
            throw new Error("Already clocked in today");
          }
          return prisma.hr_attendance.upsert({
            where: {
              employeeId_workDate: { employeeId: employee.id, workDate },
            },
            create: {
              HotelName: employee.HotelName,
              employeeId: employee.id,
              workDate,
              clockInAt: now,
              status: "present",
            },
            update: { clockInAt: now, status: "present" },
          });
        }

        if (!existing?.clockInAt) {
          throw new Error("Must clock in before clocking out");
        }
        if (existing.clockOutAt) {
          throw new Error("Already clocked out today");
        }
        return prisma.hr_attendance.update({
          where: { id: existing.id },
          data: { clockOutAt: now },
        });
      },

      upsertHrAttendance: async (
        _,
        { employeeId, workDate, clockInAt, clockOutAt, status, notes },
        context,
      ) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, employeeId);
        const { actorRole, actorName } = actorFromContext(context);
        const wd = assertYmd(workDate, "workDate");
        const onLeave = await prisma.hr_leave_request.findFirst({
          where: {
            employeeId: employee.id,
            status: "approved",
            fromYmd: { lte: wd },
            toYmd: { gte: wd },
          },
          select: { id: true },
        });
        let st = status != null ? String(status).trim() : undefined;
        if (onLeave) {
          st = "on_leave";
        } else if (st != null && !ATTENDANCE_STATUSES.has(st)) {
          throw new Error("Invalid attendance status");
        }
        const createData = {
          HotelName: employee.HotelName,
          employeeId: employee.id,
          workDate: wd,
          clockInAt: onLeave
            ? null
            : clockInAt != null
              ? new Date(clockInAt)
              : null,
          clockOutAt: onLeave
            ? null
            : clockOutAt != null
              ? new Date(clockOutAt)
              : null,
          status: st ?? (onLeave ? "on_leave" : "present"),
          notes: onLeave
            ? "Approved leave"
            : String(notes ?? "").trim(),
        };
        const updateData = {};
        if (onLeave) {
          updateData.clockInAt = null;
          updateData.clockOutAt = null;
          updateData.status = "on_leave";
          updateData.notes = "Approved leave";
        } else {
          if (clockInAt !== undefined) {
            updateData.clockInAt =
              clockInAt != null ? new Date(clockInAt) : null;
          }
          if (clockOutAt !== undefined) {
            updateData.clockOutAt =
              clockOutAt != null ? new Date(clockOutAt) : null;
          }
          if (st != null) updateData.status = st;
          if (notes != null) updateData.notes = String(notes).trim();
        }

        if (!isDeskManagerOrAdmin(actorRole)) {
          await createManagerPendingAction(prisma, {
            HotelName: employee.HotelName,
            kind: "attendance_correction",
            employeeId: employee.id,
            payloadJson: {
              workDate: wd,
              createData: {
                ...createData,
                clockInAt: createData.clockInAt
                  ? createData.clockInAt.toISOString()
                  : null,
                clockOutAt: createData.clockOutAt
                  ? createData.clockOutAt.toISOString()
                  : null,
              },
              updateData: {
                ...updateData,
                clockInAt:
                  updateData.clockInAt !== undefined
                    ? updateData.clockInAt
                      ? updateData.clockInAt.toISOString()
                      : null
                    : undefined,
                clockOutAt:
                  updateData.clockOutAt !== undefined
                    ? updateData.clockOutAt
                      ? updateData.clockOutAt.toISOString()
                      : null
                    : undefined,
              },
            },
            requestedBy: actorName,
          });
          await createHrNotification(prisma, {
            HotelName: employee.HotelName,
            recipientRole: "Manager",
            kind: "manager_pending_attendance",
            title: "Attendance correction awaiting approval",
            body: `${actorName || "HR"} requested a correction for ${employee.fullName} on ${wd}.`,
            href: "manager-pending",
            actionStatus: "pending",
            createdBy: actorName,
          });
          throw pendingManagerApprovalError(
            "Attendance correction submitted for Manager approval.",
          );
        }

        return prisma.hr_attendance.upsert({
          where: {
            employeeId_workDate: { employeeId: employee.id, workDate: wd },
          },
          create: createData,
          update: updateData,
        });
      },

      createHrShift: async (
        _,
        { employeeId, workDate, department, startTime, endTime, notes },
        context,
      ) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, employeeId);
        const wd = assertYmd(workDate, "workDate");
        return prisma.hr_shift.create({
          data: {
            HotelName: employee.HotelName,
            employeeId: employee.id,
            workDate: wd,
            department: String(department ?? "").trim(),
            startTime: String(startTime ?? "08:00").trim() || "08:00",
            endTime: String(endTime ?? "17:00").trim() || "17:00",
            notes: String(notes ?? "").trim(),
          },
        });
      },

      deleteHrShift: async (_, { id }, context) => {
        assertHrAccess(context);
        const shift = await prisma.hr_shift.findUnique({
          where: { id: Number(id) },
        });
        if (!shift || !tenantHotelReadMatches(context, shift.HotelName)) {
          throw new Error("Shift not found");
        }
        await prisma.hr_shift.delete({ where: { id: shift.id } });
        return true;
      },

      createHrDocument: async (
        _,
        { employeeId, title, docType, fileUrl, notes },
        context,
      ) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, employeeId);
        const t = String(title ?? "").trim();
        if (!t) throw new Error("Document title is required");
        let dt = String(docType ?? "other").trim();
        if (!DOC_TYPES.has(dt)) dt = "other";
        return prisma.hr_document.create({
          data: {
            HotelName: employee.HotelName,
            employeeId: employee.id,
            title: t,
            docType: dt,
            fileUrl: String(fileUrl ?? "").trim(),
            notes: String(notes ?? "").trim(),
          },
        });
      },

      deleteHrDocument: async (_, { id }, context) => {
        assertHrAccess(context);
        const doc = await prisma.hr_document.findUnique({
          where: { id: Number(id) },
        });
        if (!doc || !tenantHotelReadMatches(context, doc.HotelName)) {
          throw new Error("Document not found");
        }
        await prisma.hr_document.delete({ where: { id: doc.id } });
        return true;
      },

      createHrPayrollPeriod: async (
        _,
        { fromYmd, toYmd, notes, employeeIds, wageScope },
        context,
      ) => {
        assertHrAccess(context);
        const { actorName, actorRole } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const from = assertYmd(fromYmd, "fromYmd");
        const to = assertYmd(toYmd, "toYmd");
        if (to < from) throw new Error("toYmd must not be before fromYmd");

        if (!isDeskManagerOrAdmin(actorRole)) {
          // Stub run so HR Sees it under Runs as awaiting Manager — exact From–To kept.
          await assertNoDuplicateWagePeriodPayroll(prisma, {
            HotelName,
            from,
            to,
            wageScope,
            employeeIds,
          });
          const named = namedMonthFromPayRange(from, to);
          const existingStub = await prisma.hr_payroll_period.findUnique({
            where: {
              HotelName_fromYmd_toYmd: {
                HotelName,
                fromYmd: from,
                toYmd: to,
              },
            },
          });
          if (existingStub) {
            const st = String(existingStub.status || "").trim();
            if (st === "pending_generate") {
              await prisma.hr_payslip.deleteMany({
                where: { periodId: existingStub.id },
              });
              await prisma.hr_payroll_period.delete({
                where: { id: existingStub.id },
              });
            } else {
              throw new Error(
                "A payroll run already exists for this From–To range.",
              );
            }
          }
          const stub = await prisma.hr_payroll_period.create({
            data: {
              HotelName,
              periodKey: named.periodKey,
              monthName: named.monthName,
              fromYmd: from,
              toYmd: to,
              status: "pending_generate",
              notes: String(notes ?? "").trim(),
              createdBy: actorName,
            },
          });
          await createManagerPendingAction(prisma, {
            HotelName,
            kind: "payroll_generate",
            payloadJson: {
              fromYmd: from,
              toYmd: to,
              notes: notes != null ? String(notes) : "",
              employeeIds: Array.isArray(employeeIds)
                ? employeeIds.map((n) => Number(n)).filter((n) => n > 0)
                : null,
              wageScope: wageScope != null ? String(wageScope) : null,
              periodId: stub.id,
            },
            requestedBy: actorName,
          });
          await createHrNotification(prisma, {
            HotelName,
            recipientRole: "Manager",
            kind: "manager_pending_payroll",
            title: "Payroll generate awaiting approval",
            body: `${actorName || "HR"} requested payroll for ${from} → ${to}.`,
            href: "manager-pending",
            actionStatus: "pending",
            createdBy: actorName,
          });
          throw pendingManagerApprovalError(
            "Payroll generation submitted for Manager approval.",
          );
        }

        return runCreateHrPayrollPeriod(prisma, context, {
          HotelName,
          actorName,
          fromYmd: from,
          toYmd: to,
          notes,
          employeeIds,
          wageScope,
          tenantHotelReadMatches,
        });
      },

      markHrPayslipsPaid: async (_, { payslipIds }, context) => {
        await assertCanMarkPayslipsPaid(context);
        const { actorName } = actorFromContext(context);
        const ids = (Array.isArray(payslipIds) ? payslipIds : [])
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n));
        if (!ids.length) throw new Error("Select at least one payslip");

        const rows = await prisma.hr_payslip.findMany({
          where: { id: { in: ids } },
          include: { period: true },
        });
        for (const row of rows) {
          if (!tenantHotelReadMatches(context, row.HotelName)) {
            throw new Error("Payslip not found");
          }
          if (row.period?.status === "pending_generate") {
            throw new Error(
              "This payroll run is still awaiting Manager generate approval",
            );
          }
          if (
            row.paymentStatus === "marked_paid" ||
            row.paymentStatus === "approved"
          ) {
            throw new Error(
              `Payslip ${row.payslipNumber || row.id} is already marked paid`,
            );
          }
          if (row.paymentStatus === "awaiting_finance") {
            throw new Error(
              `Payslip ${row.payslipNumber || row.id} is already waiting on Finance`,
            );
          }
        }

        await prisma.hr_payslip.updateMany({
          where: {
            id: { in: rows.map((r) => r.id) },
            paymentStatus: "unpaid",
          },
          data: {
            paymentStatus: "awaiting_finance",
            hrMarkedPaidAt: new Date(),
            hrMarkedPaidBy: actorName,
            managerApprovedAt: null,
            managerApprovedBy: "",
          },
        });

        const periodIds = [...new Set(rows.map((r) => r.periodId))];
        for (const periodId of periodIds) {
          const unpaidLeft = await prisma.hr_payslip.count({
            where: {
              periodId,
              paymentStatus: "unpaid",
            },
          });
          if (unpaidLeft === 0) {
            await prisma.hr_payroll_period.update({
              where: { id: periodId },
              data: { status: "awaiting_manager" },
            });
          }
        }

        return prisma.hr_payslip.findMany({
          where: { id: { in: rows.map((r) => r.id) } },
          include: { employee: true, period: true },
        });
      },

      decideHrPayslipsPayment: async (_, { payslipIds, approve }, context) => {
        await assertCanDecidePayslipPayment(context);
        const { actorName } = actorFromContext(context);
        const ids = (Array.isArray(payslipIds) ? payslipIds : [])
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n));
        if (!ids.length) throw new Error("Select at least one payslip");

        const rows = await prisma.hr_payslip.findMany({
          where: { id: { in: ids } },
          include: { period: true },
        });
        for (const row of rows) {
          if (!tenantHotelReadMatches(context, row.HotelName)) {
            throw new Error("Payslip not found");
          }
          // awaiting_finance (new) or legacy marked_paid (pre-Finance-confirm)
          const st = String(row.paymentStatus || "");
          if (st !== "awaiting_finance" && st !== "marked_paid") {
            throw new Error(
              `Payslip ${row.payslipNumber || row.id} is not awaiting Finance`,
            );
          }
          // Legacy marked_paid that already has managerApprovedAt is done
          if (st === "marked_paid" && row.managerApprovedAt) {
            throw new Error(
              `Payslip ${row.payslipNumber || row.id} is already confirmed`,
            );
          }
        }

        if (approve) {
          await prisma.hr_payslip.updateMany({
            where: { id: { in: rows.map((r) => r.id) } },
            data: {
              paymentStatus: "marked_paid",
              managerApprovedAt: new Date(),
              managerApprovedBy: actorName,
            },
          });
        } else {
          await prisma.hr_payslip.updateMany({
            where: { id: { in: rows.map((r) => r.id) } },
            data: {
              paymentStatus: "unpaid",
              hrMarkedPaidAt: null,
              hrMarkedPaidBy: "",
              managerApprovedAt: null,
              managerApprovedBy: "",
            },
          });
        }

        const periodIds = [...new Set(rows.map((r) => r.periodId))];
        for (const periodId of periodIds) {
          if (approve) {
            // All slips marked paid → ready for Manager Close (do not auto-close)
            const pending = await prisma.hr_payslip.count({
              where: {
                periodId,
                paymentStatus: {
                  in: ["unpaid", "awaiting_finance"],
                },
              },
            });
            if (pending === 0) {
              await prisma.hr_payroll_period.update({
                where: { id: periodId },
                data: {
                  status: "awaiting_manager",
                  closedAt: null,
                  closedBy: "",
                },
              });
            }
          } else {
            await prisma.hr_payroll_period.update({
              where: { id: periodId },
              data: { status: "open", closedAt: null, closedBy: "" },
            });
          }
        }

        const updatedSlips = await prisma.hr_payslip.findMany({
          where: { id: { in: rows.map((r) => r.id) } },
          include: { employee: true, period: true },
        });
        if (approve) {
          await notifyEmployeesPayslipMarkedPaid(prisma, updatedSlips, {
            createdBy: actorName,
          });
        }
        return updatedSlips;
      },

      approveHrPayslipsPayment: async (_, { payslipIds }, context) => {
        // Back-compat: Manager/Admin may still confirm; prefer Finance decideHrPayslipsPayment.
        const { actorRole } = actorFromContext(context);
        if (actorRole === "Finance") {
          await assertCanDecidePayslipPayment(context);
        } else {
          assertLeaveManager(context);
        }
        const { actorName } = actorFromContext(context);
        const ids = (Array.isArray(payslipIds) ? payslipIds : [])
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n));
        if (!ids.length) throw new Error("Select at least one payslip");

        const rows = await prisma.hr_payslip.findMany({
          where: { id: { in: ids } },
        });
        for (const row of rows) {
          if (!tenantHotelReadMatches(context, row.HotelName)) {
            throw new Error("Payslip not found");
          }
          const st = String(row.paymentStatus || "");
          if (st !== "awaiting_finance" && st !== "marked_paid") {
            throw new Error(
              `Payslip ${row.payslipNumber || row.id} must be marked paid by HR first`,
            );
          }
        }

        await prisma.hr_payslip.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: {
            paymentStatus: "marked_paid",
            managerApprovedAt: new Date(),
            managerApprovedBy: actorName,
          },
        });

        const periodIds = [...new Set(rows.map((r) => r.periodId))];
        for (const periodId of periodIds) {
          const pending = await prisma.hr_payslip.count({
            where: {
              periodId,
              paymentStatus: {
                in: ["unpaid", "awaiting_finance"],
              },
            },
          });
          if (pending === 0) {
            // Ready for explicit Close — do not auto-close
            await prisma.hr_payroll_period.update({
              where: { id: periodId },
              data: {
                status: "awaiting_manager",
                closedAt: null,
                closedBy: "",
              },
            });
          }
        }

        const confirmedSlips = await prisma.hr_payslip.findMany({
          where: { id: { in: rows.map((r) => r.id) } },
          include: { employee: true, period: true },
        });
        await notifyEmployeesPayslipMarkedPaid(prisma, confirmedSlips, {
          createdBy: actorName,
        });
        return confirmedSlips;
      },

      closeHrPayrollPeriod: async (_, { id }, context) => {
        const { actorRole, actorName } = actorFromContext(context);
        if (actorRole === "Finance") {
          await assertCanDecidePayslipPayment(context);
        } else {
          assertLeaveManager(context);
        }
        const periodId = Number(id);
        const period = await prisma.hr_payroll_period.findUnique({
          where: { id: periodId },
        });
        if (!period || !tenantHotelReadMatches(context, period.HotelName)) {
          throw new Error("Payroll period not found");
        }
        if (period.status === "closed") {
          return period;
        }
        const slips = await prisma.hr_payslip.findMany({
          where: { periodId },
        });
        if (!slips.length) {
          throw new Error("This payroll run has no payslips to close");
        }
        const notReady = slips.find((s) => {
          const st = String(s.paymentStatus || "");
          // Close only when every slip is marked paid (or legacy approved)
          if (st === "approved" || st === "marked_paid") return false;
          return true;
        });
        if (notReady) {
          throw new Error(
            "Close is only allowed when every payslip is marked paid",
          );
        }
        // Stamp confirm on any marked_paid still missing managerApprovedAt
        await prisma.hr_payslip.updateMany({
          where: {
            periodId,
            paymentStatus: "marked_paid",
            managerApprovedAt: null,
          },
          data: {
            managerApprovedAt: new Date(),
            managerApprovedBy: actorName,
          },
        });
        return prisma.hr_payroll_period.update({
          where: { id: periodId },
          data: {
            status: "closed",
            closedAt: new Date(),
            closedBy: actorName,
          },
        });
      },

      replaceHrPayrollLineRules: async (_, { rules }, context) => {
        assertLeaveManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const incoming = Array.isArray(rules) ? rules : [];
        const rows = [];
        incoming.forEach((row, index) => {
          const label = String(row?.label ?? "").trim();
          if (!label) return;
          const kind = String(row?.kind ?? "").trim();
          if (!PAYROLL_LINE_KINDS.has(kind)) return;
          let whenMode = String(row?.whenMode ?? "always").trim() || "always";
          if (whenMode !== "day_range") whenMode = "always";
          let fromYmd = String(row?.fromYmd ?? "").trim();
          let toYmd = String(row?.toYmd ?? "").trim();
          let fromDay = null;
          let toDay = null;
          if (whenMode === "day_range") {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) {
              throw new Error(
                `Day range for "${label}" needs initial and final calendar dates`,
              );
            }
            if (toYmd < fromYmd) {
              throw new Error(
                `Day range for "${label}": final date must not be before initial`,
              );
            }
          } else {
            fromYmd = "";
            toYmd = "";
          }
          const customized = Boolean(row?.customized);
          const fromAmountETB = Math.max(0, Number(row?.fromAmountETB) || 0);
          let toAmountETB = null;
          if (
            customized &&
            row?.toAmountETB != null &&
            String(row.toAmountETB).trim() !== ""
          ) {
            toAmountETB = Number(row.toAmountETB);
            if (!Number.isFinite(toAmountETB) || toAmountETB <= fromAmountETB) {
              throw new Error(
                `Customized "${label}": final amount must be greater than initial`,
              );
            }
          }
          rows.push({
            kind,
            label,
            percentOfSalary: Math.max(
              0,
              Math.min(100, Number(row?.percentOfSalary) || 0),
            ),
            amountETB: round2(Number(row?.amountETB) || 0),
            whenMode,
            fromDay,
            toDay,
            fromYmd,
            toYmd,
            customized,
            fromAmountETB: customized ? fromAmountETB : 0,
            toAmountETB: customized ? toAmountETB : null,
            active: row?.active !== false,
            sortOrder: index,
          });
        });

        await prisma.$transaction(async (tx) => {
          await tx.hr_payroll_line_rule.deleteMany({ where: { HotelName } });
          if (rows.length) {
            await tx.hr_payroll_line_rule.createMany({
              data: rows.map((r) => ({ HotelName, ...r })),
            });
          }
        });

        return prisma.hr_payroll_line_rule.findMany({
          where: { HotelName },
          orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
        });
      },

      replaceHrWagePayWindows: async (_, { windows }, context) => {
        assertLeaveManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const incoming = Array.isArray(windows) ? windows : [];
        const seen = new Set();
        const rows = [];
        for (const row of incoming) {
          const wageType = String(row?.wageType ?? "").trim();
          if (!WAGE_TYPES.has(wageType) || seen.has(wageType)) continue;
          seen.add(wageType);
          let fromDay = Number(row?.fromDay);
          let toDay = Number(row?.toDay);
          if (!Number.isFinite(fromDay) || fromDay < 1 || fromDay > 31) {
            throw new Error(`Invalid from day for ${wageType}`);
          }
          if (!Number.isFinite(toDay) || toDay < 1 || toDay > 31) {
            throw new Error(`Invalid to day for ${wageType}`);
          }
          rows.push({
            wageType,
            fromDay: Math.trunc(fromDay),
            toDay: Math.trunc(toDay),
            active: row?.active !== false,
          });
        }

        await prisma.$transaction(async (tx) => {
          await tx.hr_wage_pay_window.deleteMany({ where: { HotelName } });
          if (rows.length) {
            await tx.hr_wage_pay_window.createMany({
              data: rows.map((r) => ({ HotelName, ...r })),
            });
          }
        });

        return prisma.hr_wage_pay_window.findMany({
          where: { HotelName },
          orderBy: { wageType: "asc" },
        });
      },

      createHrIncident: async (
        _,
        {
          employeeId,
          kind,
          title,
          detail,
          occurredYmd,
          recordedBy,
          salaryDeduct,
          percentOfSalary,
          amountETB,
        },
        context,
      ) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, employeeId);
        const t = String(title ?? "").trim();
        if (!t) throw new Error("Incident title is required");
        let k = String(kind ?? "other")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 40);
        if (!k) k = "other";
        const occurred =
          occurredYmd != null && String(occurredYmd).trim() !== ""
            ? assertYmd(occurredYmd, "occurredYmd")
            : todayYmd();
        const { actorName } = actorFromContext(context);
        const percent = Math.max(
          0,
          Math.min(100, round2(Number(percentOfSalary) || 0)),
        );
        const amount =
          percent > 0
            ? 0
            : Math.max(0, Number(amountETB) || 0);
        return prisma.hr_incident.create({
          data: {
            HotelName: employee.HotelName,
            employeeId: employee.id,
            kind: k,
            title: t,
            detail: String(detail ?? "").trim(),
            occurredYmd: occurred,
            recordedBy: String(recordedBy ?? actorName ?? "").trim(),
            salaryDeduct: Boolean(salaryDeduct),
            percentOfSalary: percent,
            amountETB: amount,
          },
        });
      },

      deleteHrIncident: async (_, { id }, context) => {
        assertHrAccess(context);
        const incident = await prisma.hr_incident.findUnique({
          where: { id: Number(id) },
        });
        if (!incident || !tenantHotelReadMatches(context, incident.HotelName)) {
          throw new Error("Incident not found");
        }
        await prisma.hr_incident.delete({ where: { id: incident.id } });
        return true;
      },

      enableHrEmployeePortal: async (_, { id }, context) => {
        assertHrAccess(context);
        const { actorRole } = actorFromContext(context);
        if (actorRole !== "HR" && actorRole !== "Admin") {
          throw new Error("Only HR Manager can issue portal OTP");
        }
        const employee = await loadEmployeeInTenantOrThrow(context, id);
        if (employee.status === "terminated") {
          throw new Error("Cannot enable portal for a terminated employee");
        }
        // Already issued and waiting for first login — do not mint a new code.
        if (
          String(employee.portalOtpLookup || "").trim() ||
          employee.portalOtpIssuedAt
        ) {
          if (!employee.portalFirstLoginAt) {
            return employee;
          }
          throw new Error(
            "Portal already enabled — request an OTP reset for Manager approval",
          );
        }
        await issueUniquePortalOtp(prisma, employee.id, "HR");
        return prisma.hr_employee.findUnique({ where: { id: employee.id } });
      },

      requestHrOtpReset: async (_, { employeeId }, context) => {
        assertHrAccess(context);
        const { actorRole, actorName } = actorFromContext(context);
        if (actorRole !== "HR" && actorRole !== "Admin") {
          throw new Error("Only HR Manager can request OTP reset");
        }
        const employee = await loadEmployeeInTenantOrThrow(context, employeeId);
        if (employee.status === "terminated") {
          throw new Error("Cannot reset OTP for a terminated employee");
        }
        const HotelName = employee.HotelName;
        const pending = await prisma.hr_otp_reset_request.findFirst({
          where: {
            HotelName,
            employeeId: employee.id,
            status: "pending",
          },
        });
        if (pending) {
          throw new Error("An OTP reset request is already pending for this employee");
        }
        const req = await prisma.hr_otp_reset_request.create({
          data: {
            HotelName,
            employeeId: employee.id,
            requestedBy: actorName,
            status: "pending",
          },
          include: { employee: true },
        });
        await createHrNotification(prisma, {
          HotelName,
          recipientRole: "Manager",
          kind: "otp_reset_pending",
          title: "OTP reset needs approval",
          body: `${actorName} requested a portal OTP reset for ${employee.fullName}.`,
          href: `/HR?section=otp-reset`,
          actionStatus: "pending",
          createdBy: actorName,
        });
        return { ...req, portalOtpPreview: "" };
      },

      decideHrOtpReset: async (_, { id, approve }, context) => {
        assertLeaveManager(context);
        const { actorRole, actorName } = actorFromContext(context);
        if (actorRole !== "Manager" && actorRole !== "Admin") {
          throw new Error("Only Manager can approve OTP reset");
        }
        const req = await prisma.hr_otp_reset_request.findUnique({
          where: { id: Number(id) },
          include: { employee: true },
        });
        if (!req || !tenantHotelReadMatches(context, req.HotelName)) {
          throw new Error("OTP reset request not found");
        }
        if (req.status !== "pending") {
          throw new Error("OTP reset request is not pending");
        }
        if (!approve) {
          const rejected = await prisma.hr_otp_reset_request.update({
            where: { id: req.id },
            data: {
              status: "rejected",
              decidedBy: actorName,
              decidedAt: new Date(),
            },
            include: { employee: true },
          });
          await createHrNotification(prisma, {
            HotelName: req.HotelName,
            recipientRole: "HR",
            kind: "otp_reset_decided",
            title: "OTP reset rejected",
            body: `Manager rejected OTP reset for ${req.employee?.fullName || "employee"}.`,
            href: `/HR?section=employees`,
            actionStatus: "done",
            createdBy: actorName,
          });
          return { ...rejected, portalOtpPreview: "" };
        }

        await issueUniquePortalOtp(prisma, req.employeeId, "Manager");
        await prisma.hr_otp_reset_request.update({
          where: { id: req.id },
          data: {
            status: "approved",
            decidedBy: actorName,
            decidedAt: new Date(),
          },
        });
        const updated = await prisma.hr_otp_reset_request.findUnique({
          where: { id: req.id },
          include: { employee: true },
        });
        await createHrNotification(prisma, {
          HotelName: req.HotelName,
          recipientRole: "HR",
          kind: "otp_reset_decided",
          title: "OTP reset approved",
          body: `Manager approved OTP reset for ${req.employee?.fullName || "employee"}. The new code is visible only to Manager until first login.`,
          href: `/HR?section=employees`,
          actionStatus: "done",
          createdBy: actorName,
        });
        return {
          ...updated,
          portalOtpPreview: visiblePortalOtpPreview(updated.employee, context),
        };
      },

      decideHrManagerPendingAction: async (_, { id, approve }, context) => {
        assertLeaveManager(context);
        const { actorName } = actorFromContext(context);
        const row = await prisma.hr_manager_pending_action.findUnique({
          where: { id: Number(id) },
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("Pending action not found");
        }
        if (row.status !== "pending") {
          throw new Error("Action is not pending");
        }

        if (!approve) {
          const rejected = await prisma.hr_manager_pending_action.update({
            where: { id: row.id },
            data: {
              status: "rejected",
              decidedBy: actorName,
              decidedAt: new Date(),
            },
          });
          await createHrNotification(prisma, {
            HotelName: row.HotelName,
            recipientRole: "HR",
            kind: "manager_pending_decided",
            title: "Request rejected",
            body: `Manager rejected ${row.kind.replaceAll("_", " ")} request.`,
            href:
              row.kind === "payroll_generate"
                ? `/HR?section=payroll-runs`
                : "manager-pending",
            actionStatus: "done",
            createdBy: actorName,
          });
          // Clear the original Manager bell item for this request.
          await prisma.hr_notification.updateMany({
            where: {
              HotelName: row.HotelName,
              recipientRole: "Manager",
              actionStatus: "pending",
              kind:
                row.kind === "payroll_generate"
                  ? "manager_pending_payroll"
                  : row.kind === "terminate"
                    ? "manager_pending_terminate"
                    : "manager_pending_attendance",
            },
            data: { actionStatus: "done" },
          });

          if (row.kind === "payroll_generate") {
            const payload =
              row.payloadJson && typeof row.payloadJson === "object"
                ? row.payloadJson
                : {};
            const stubId = Number(payload.periodId);
            if (Number.isFinite(stubId) && stubId > 0) {
              const stub = await prisma.hr_payroll_period.findUnique({
                where: { id: stubId },
              });
              if (
                stub &&
                stub.HotelName === row.HotelName &&
                stub.status === "pending_generate"
              ) {
                await prisma.hr_payslip.deleteMany({
                  where: { periodId: stub.id },
                });
                await prisma.hr_payroll_period.delete({
                  where: { id: stub.id },
                });
              }
            } else {
              const from = String(payload.fromYmd || "").trim();
              const to = String(payload.toYmd || "").trim();
              if (YMD_RE.test(from) && YMD_RE.test(to)) {
                const stub = await prisma.hr_payroll_period.findUnique({
                  where: {
                    HotelName_fromYmd_toYmd: {
                      HotelName: row.HotelName,
                      fromYmd: from,
                      toYmd: to,
                    },
                  },
                });
                if (stub && stub.status === "pending_generate") {
                  await prisma.hr_payslip.deleteMany({
                    where: { periodId: stub.id },
                  });
                  await prisma.hr_payroll_period.delete({
                    where: { id: stub.id },
                  });
                }
              }
            }
          }
          return rejected;
        }

        const payload = row.payloadJson && typeof row.payloadJson === "object"
          ? row.payloadJson
          : {};

        if (row.kind === "terminate") {
          if (!row.employeeId) throw new Error("Missing employee on terminate request");
          const ed =
            payload.endDate && String(payload.endDate).trim()
              ? assertYmd(payload.endDate, "endDate")
              : todayYmd();
          await prisma.hr_employee.update({
            where: { id: row.employeeId },
            data: {
              status: "terminated",
              endDate: ed,
              ...clearPortalOtpLoginFields(),
            },
          });
        } else if (row.kind === "attendance_correction") {
          if (!row.employeeId) throw new Error("Missing employee on attendance request");
          const wd = assertYmd(payload.workDate, "workDate");
          const reviveDate = (v) =>
            v == null || v === undefined ? v : v ? new Date(v) : null;
          const createData = {
            ...(payload.createData || {}),
            HotelName: row.HotelName,
            employeeId: row.employeeId,
            workDate: wd,
            clockInAt: reviveDate(payload.createData?.clockInAt),
            clockOutAt: reviveDate(payload.createData?.clockOutAt),
          };
          const updateData = { ...(payload.updateData || {}) };
          if (updateData.clockInAt !== undefined) {
            updateData.clockInAt = reviveDate(updateData.clockInAt);
          }
          if (updateData.clockOutAt !== undefined) {
            updateData.clockOutAt = reviveDate(updateData.clockOutAt);
          }
          await prisma.hr_attendance.upsert({
            where: {
              employeeId_workDate: {
                employeeId: row.employeeId,
                workDate: wd,
              },
            },
            create: createData,
            update: updateData,
          });
        } else if (row.kind === "payroll_generate") {
          const from = assertYmd(payload.fromYmd, "fromYmd");
          const to = assertYmd(payload.toYmd, "toYmd");
          const stubId = Number(payload.periodId);
          if (Number.isFinite(stubId) && stubId > 0) {
            const stub = await prisma.hr_payroll_period.findUnique({
              where: { id: stubId },
            });
            if (
              stub &&
              stub.HotelName === row.HotelName &&
              stub.status === "pending_generate"
            ) {
              await prisma.hr_payslip.deleteMany({
                where: { periodId: stub.id },
              });
              await prisma.hr_payroll_period.delete({
                where: { id: stub.id },
              });
            }
          } else {
            const stub = await prisma.hr_payroll_period.findUnique({
              where: {
                HotelName_fromYmd_toYmd: {
                  HotelName: row.HotelName,
                  fromYmd: from,
                  toYmd: to,
                },
              },
            });
            if (stub && stub.status === "pending_generate") {
              await prisma.hr_payslip.deleteMany({
                where: { periodId: stub.id },
              });
              await prisma.hr_payroll_period.delete({
                where: { id: stub.id },
              });
            }
          }
          // Always use the requested From–To (never snap to calendar month).
          const period = await runCreateHrPayrollPeriod(prisma, context, {
            HotelName: row.HotelName,
            actorName: row.requestedBy || actorName,
            fromYmd: from,
            toYmd: to,
            notes: payload.notes,
            employeeIds: payload.employeeIds,
            wageScope: payload.wageScope,
          });
          await notifyEmployeesPayslipReady(prisma, {
            HotelName: row.HotelName,
            period,
            createdBy: actorName,
          });
        } else {
          throw new Error(`Unknown pending kind: ${row.kind}`);
        }

        const approved = await prisma.hr_manager_pending_action.update({
          where: { id: row.id },
          data: {
            status: "approved",
            decidedBy: actorName,
            decidedAt: new Date(),
          },
        });
        await createHrNotification(prisma, {
          HotelName: row.HotelName,
          recipientRole: "HR",
          kind: "manager_pending_decided",
          title: "Request approved",
          body: `Manager approved ${row.kind.replaceAll("_", " ")} request.`,
          href: "manager-pending",
          actionStatus: "done",
          createdBy: actorName,
        });
        return approved;
      },

      markHrNotificationRead: async (_, { id }, context) => {
        assertHrAccess(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorRole } = actorFromContext(context);
        return markHrNotificationRead(prisma, {
          id,
          HotelName,
          role: actorRole,
        });
      },

      createHrEmployeeNotification: async (
        _,
        { employeeIds, title, body, href },
        context,
      ) => {
        assertHrAccess(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        const ids = (employeeIds || []).map(Number).filter((n) => n > 0);
        for (const eid of ids) {
          await loadEmployeeInTenantOrThrow(context, eid);
        }
        return createHrEmployeeNotifications(prisma, {
          HotelName,
          employeeIds: ids,
          title,
          body,
          href: href || `/`,
          createdBy: actorName,
        });
      },
    },

    HrOtpResetRequest: {
      portalOtpPreview: (row, _, context) => {
        if (row.status !== "approved" || !row.employee) return "";
        return visiblePortalOtpPreview(row.employee, context);
      },
      employee: (row) => row.employee ?? null,
    },

    HrManagerPendingAction: {
      employee: async (row) => {
        if (!row.employeeId) return null;
        return prisma.hr_employee.findUnique({
          where: { id: Number(row.employeeId) },
        });
      },
    },
  };
}
