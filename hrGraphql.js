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
  generatePortalOtp,
  hashPortalOtp,
  issuePortalOtpPayload,
} from "./hrPortalOtp.js";
import {
  createHrNotification,
  listHrNotificationsForActor,
  markHrNotificationRead,
  createHrEmployeeNotifications,
} from "./hrNotifications.js";
import {
  decideLeaveOnEngine,
  normalizeSteps,
  prepareLeaveFlowAttachment,
  recordEscalations,
  resolveAssignees,
  STEP_KINDS,
} from "./hrApprovalEngine.js";

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
    ): HrEmployee!
    terminateHrEmployee(id: Int!, endDate: String): HrEmployee!

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
    approveHrPayslipsPayment(payslipIds: [Int!]!): [HrPayslip!]!
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

function slugLeaveTypeCode(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
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

  function dayOfYmd(ymd) {
    return Number(String(ymd).slice(8, 10));
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

  function lineRuleApplies(rule, fromYmd, toYmd) {
    if (rule.active === false) return false;
    const mode = String(rule.whenMode || "always").trim();
    if (mode !== "day_range") return true;
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
        assertHrAccess(context);
        return prisma.hr_payroll_period.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: [{ fromYmd: "desc" }, { id: "desc" }],
        });
      },

      hrPayslips: async (_, { periodId, paymentStatus }, context) => {
        assertHrAccess(context);
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
        const ed =
          endDate != null && String(endDate).trim() !== ""
            ? assertYmd(endDate, "endDate")
            : todayYmd();
        return prisma.hr_employee.update({
          where: { id: employee.id },
          data: { status: "terminated", endDate: ed },
        });
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
        assertPayrollRunner(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        const from = assertYmd(fromYmd, "fromYmd");
        const to = assertYmd(toYmd, "toYmd");
        if (to < from) throw new Error("toYmd must not be before fromYmd");
        const named = namedMonthFromPayRange(from, to);
        const payDate = todayYmd();
        const rangeDays = inclusiveDayCount(from, to);

        const existing = await prisma.hr_payroll_period.findUnique({
          where: {
            HotelName_fromYmd_toYmd: { HotelName, fromYmd: from, toYmd: to },
          },
        });
        if (existing) {
          const st = String(existing.status || "").trim();
          // Open runs can be replaced so later incidents/attendance are picked up.
          if (st === "open") {
            await prisma.hr_payroll_period.delete({
              where: { id: existing.id },
            });
          } else {
            throw new Error(
              "A payroll run already exists for this From–To range. Only open runs can be replaced — choose different dates or keep the existing run.",
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

            const built = buildIntegratedPayLines({
              employee,
              fromYmd: from,
              toYmd: to,
              appliedRules,
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
      },

      markHrPayslipsPaid: async (_, { payslipIds }, context) => {
        assertPayrollRunner(context);
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
          if (row.paymentStatus === "approved") {
            throw new Error(
              `Payslip ${row.payslipNumber || row.id} is already approved`,
            );
          }
        }

        await prisma.hr_payslip.updateMany({
          where: {
            id: { in: rows.map((r) => r.id) },
            paymentStatus: { in: ["unpaid", "marked_paid"] },
          },
          data: {
            paymentStatus: "marked_paid",
            hrMarkedPaidAt: new Date(),
            hrMarkedPaidBy: actorName,
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

      approveHrPayslipsPayment: async (_, { payslipIds }, context) => {
        assertLeaveManager(context);
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
          if (row.paymentStatus !== "marked_paid") {
            throw new Error(
              `Payslip ${row.payslipNumber || row.id} must be marked paid by HR first`,
            );
          }
        }

        await prisma.hr_payslip.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: {
            paymentStatus: "approved",
            managerApprovedAt: new Date(),
            managerApprovedBy: actorName,
          },
        });

        const periodIds = [...new Set(rows.map((r) => r.periodId))];
        for (const periodId of periodIds) {
          const pending = await prisma.hr_payslip.count({
            where: {
              periodId,
              paymentStatus: { not: "approved" },
            },
          });
          if (pending === 0) {
            await prisma.hr_payroll_period.update({
              where: { id: periodId },
              data: {
                status: "approved",
                closedAt: new Date(),
                closedBy: actorName,
              },
            });
          }
        }

        return prisma.hr_payslip.findMany({
          where: { id: { in: rows.map((r) => r.id) } },
          include: { employee: true, period: true },
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
          let fromDay =
            row?.fromDay != null && row.fromDay !== ""
              ? Number(row.fromDay)
              : null;
          let toDay =
            row?.toDay != null && row.toDay !== "" ? Number(row.toDay) : null;
          if (whenMode === "day_range") {
            if (!Number.isFinite(fromDay) || fromDay < 1 || fromDay > 31) {
              fromDay = 1;
            }
            if (!Number.isFinite(toDay) || toDay < 1 || toDay > 31) {
              toDay = 31;
            }
          } else {
            fromDay = null;
            toDay = null;
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
        const plain = generatePortalOtp();
        const hash = await hashPortalOtp(plain);
        const issued = issuePortalOtpPayload(plain, "HR");
        return prisma.hr_employee.update({
          where: { id: employee.id },
          data: {
            portalOtpHash: hash,
            portalOtpPreview: issued.portalOtpPreview,
            portalOtpViewer: issued.portalOtpViewer,
            mustChangeOtp: true,
            portalOtpIssuedAt: issued.portalOtpIssuedAt,
            portalFirstLoginAt: null,
          },
        });
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

        const plain = generatePortalOtp();
        const hash = await hashPortalOtp(plain);
        const issued = issuePortalOtpPayload(plain, "Manager");
        await prisma.$transaction([
          prisma.hr_employee.update({
            where: { id: req.employeeId },
            data: {
              portalOtpHash: hash,
              portalOtpPreview: issued.portalOtpPreview,
              portalOtpViewer: "Manager",
              mustChangeOtp: true,
              portalOtpIssuedAt: issued.portalOtpIssuedAt,
              portalFirstLoginAt: null,
            },
          }),
          prisma.hr_otp_reset_request.update({
            where: { id: req.id },
            data: {
              status: "approved",
              decidedBy: actorName,
              decidedAt: new Date(),
            },
          }),
        ]);
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
  };
}
