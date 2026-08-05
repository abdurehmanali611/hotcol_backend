/**
 * HR Module — Phase 2 GraphQL API.
 * Employee master, leave requests + balances, attendance/shifts, document
 * metadata, payroll periods + payslips, incidents/warnings.
 *
 * Explicitly out of scope: job posting, applicants, recruiting pipeline.
 *
 * Wired into BackEnd/index.js (types + Query/Mutation fields + resolvers),
 * following the pattern established by lodgingGraphql.js.
 */

import bcrypt from "bcryptjs";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const EMPLOYEE_STATUSES = new Set(["active", "on_leave", "terminated"]);
const WAGE_TYPES = new Set(["hourly", "monthly", "tip_eligible"]);
const LEAVE_STATUSES = new Set(["pending", "approved", "rejected", "cancelled"]);
const ATTENDANCE_STATUSES = new Set(["present", "late", "absent", "half_day"]);
const DOC_TYPES = new Set(["contract", "id", "certificate", "other"]);
const PAYROLL_PERIOD_STATUSES = new Set(["open", "closed"]);
const INCIDENT_KINDS = new Set(["warning", "complaint", "commendation", "other"]);
const HR_STAFF_ROLES = ["HR", "Admin", "Manager"];

export const hrTypeDefsBlock = `
  type HrEmployee {
    id: Int!
    HotelName: String!
    fullName: String!
    phone: String!
    email: String!
    department: String!
    jobTitle: String!
    status: String!
    hireDate: String!
    endDate: String!
    wageType: String!
    baseSalaryETB: Float!
    credentialUserId: Int
    credentialUserName: String!
    notes: String!
    createdAt: DateTime!
    updatedAt: DateTime!
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
    fromYmd: String!
    toYmd: String!
    status: String!
    notes: String!
    closedAt: DateTime
    closedBy: String!
    createdAt: DateTime!
  }

  type HrPayslip {
    id: Int!
    HotelName: String!
    periodId: Int!
    employeeId: Int!
    basePayETB: Float!
    overtimeETB: Float!
    tipsETB: Float!
    deductionsETB: Float!
    netPayETB: Float!
    notes: String!
    createdAt: DateTime!
    employee: HrEmployee
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
`;

export const hrQueryFields = `
    hrEmployees: [HrEmployee!]!
    hrEmployee(id: Int!): HrEmployee
    hrEmployeeMe: HrEmployee
    hrLeaveTypes: [HrLeaveType!]!
    hrLeaveRequests(status: String): [HrLeaveRequest!]!
    hrLeaveBalances(employeeId: Int): [HrLeaveBalance!]!
    hrAttendance(fromYmd: String!, toYmd: String!, employeeId: Int): [HrAttendance!]!
    hrShifts(fromYmd: String!, toYmd: String!, employeeId: Int): [HrShift!]!
    hrDocuments(employeeId: Int): [HrDocument!]!
    hrPayrollPeriods: [HrPayrollPeriod!]!
    hrPayslips(periodId: Int!): [HrPayslip!]!
    hrIncidents(employeeId: Int): [HrIncident!]!
    hrDashboardStats: HrDashboardStats!
`;

export const hrMutationFields = `
    createHrEmployee(
      fullName: String!
      phone: String
      email: String
      department: String
      jobTitle: String
      hireDate: String
      wageType: String
      baseSalaryETB: Float
      credentialUserId: Int
      credentialUserName: String
      credentialPassword: String
      notes: String
    ): HrEmployee!
    updateHrEmployee(
      id: Int!
      fullName: String
      phone: String
      email: String
      department: String
      jobTitle: String
      status: String
      wageType: String
      baseSalaryETB: Float
      credentialUserId: Int
      credentialUserName: String
      notes: String
    ): HrEmployee!
    terminateHrEmployee(id: Int!, endDate: String): HrEmployee!

    replaceHrLeaveTypes(types: [HrLeaveTypeInput!]!): [HrLeaveType!]!

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
    decideHrLeaveRequest(id: Int!, approve: Boolean!): HrLeaveRequest!

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
      periodKey: String!
      fromYmd: String!
      toYmd: String!
      notes: String
    ): HrPayrollPeriod!
    closeHrPayrollPeriod(id: Int!): HrPayrollPeriod!
    upsertHrPayslip(
      id: Int
      periodId: Int!
      employeeId: Int!
      basePayETB: Float
      overtimeETB: Float
      tipsETB: Float
      deductionsETB: Float
      notes: String
    ): HrPayslip!

    createHrIncident(
      employeeId: Int!
      kind: String
      title: String!
      detail: String
      occurredYmd: String
      recordedBy: String
    ): HrIncident!
    deleteHrIncident(id: Int!): Boolean!
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
  const assertHrStaffOrEmployee = (context) =>
    assertRole(context, [...HR_STAFF_ROLES, "Employee"]);
  const assertHrAccess = assertHrStaff;

  function isEmployeeActor(context) {
    return actorFromContext(context).actorRole === "Employee";
  }

  async function loadLinkedEmployee(context) {
    const { actorName } = actorFromContext(context);
    if (!actorName) return null;
    return prisma.hr_employee.findFirst({
      where: {
        ...tenantHotelReadWhere(context),
        credentialUserName: actorName,
      },
    });
  }

  async function requireLinkedEmployee(context) {
    const employee = await loadLinkedEmployee(context);
    if (!employee) {
      throw new Error("No employee record is linked to this login");
    }
    return employee;
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

  return {
    Query: {
      hrEmployees: async (_, __, context) => {
        assertHrStaffOrEmployee(context);
        if (isEmployeeActor(context)) {
          const mine = await loadLinkedEmployee(context);
          return mine ? [mine] : [];
        }
        return prisma.hr_employee.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: [{ status: "asc" }, { fullName: "asc" }],
        });
      },

      hrEmployee: async (_, { id }, context) => {
        assertHrStaffOrEmployee(context);
        const employee = await prisma.hr_employee.findUnique({
          where: { id: Number(id) },
        });
        if (!employee || !tenantHotelReadMatches(context, employee.HotelName)) {
          return null;
        }
        if (isEmployeeActor(context)) {
          const mine = await loadLinkedEmployee(context);
          if (!mine || mine.id !== employee.id) return null;
        }
        return employee;
      },

      hrEmployeeMe: async (_, __, context) => {
        assertHrStaffOrEmployee(context);
        return loadLinkedEmployee(context);
      },

      hrLeaveTypes: async (_, __, context) => {
        assertHrStaffOrEmployee(context);
        return prisma.hr_leave_type.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        });
      },

      hrLeaveRequests: async (_, { status }, context) => {
        assertHrStaffOrEmployee(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (isEmployeeActor(context)) {
          const mine = await requireLinkedEmployee(context);
          where.employeeId = mine.id;
        }
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
        assertHrStaffOrEmployee(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (isEmployeeActor(context)) {
          const mine = await requireLinkedEmployee(context);
          where.employeeId = mine.id;
        } else if (employeeId != null) {
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
        const from = assertYmd(fromYmd, "fromYmd");
        const to = assertYmd(toYmd, "toYmd");
        const where = {
          ...tenantHotelReadWhere(context),
          workDate: { gte: from, lte: to },
        };
        if (employeeId != null) where.employeeId = Number(employeeId);
        return prisma.hr_attendance.findMany({
          where,
          include: { employee: true },
          orderBy: [{ workDate: "desc" }, { employeeId: "asc" }],
        });
      },

      hrShifts: async (_, { fromYmd, toYmd, employeeId }, context) => {
        assertHrAccess(context);
        const from = assertYmd(fromYmd, "fromYmd");
        const to = assertYmd(toYmd, "toYmd");
        const where = {
          ...tenantHotelReadWhere(context),
          workDate: { gte: from, lte: to },
        };
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
        assertHrStaffOrEmployee(context);
        return prisma.hr_payroll_period.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: { periodKey: "desc" },
        });
      },

      hrPayslips: async (_, { periodId }, context) => {
        assertHrStaffOrEmployee(context);
        const period = await prisma.hr_payroll_period.findUnique({
          where: { id: Number(periodId) },
        });
        if (!period || !tenantHotelReadMatches(context, period.HotelName)) {
          throw new Error("Payroll period not found");
        }
        const where = { periodId: period.id };
        if (isEmployeeActor(context)) {
          const mine = await requireLinkedEmployee(context);
          where.employeeId = mine.id;
        }
        return prisma.hr_payslip.findMany({
          where,
          include: { employee: true },
          orderBy: { employeeId: "asc" },
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
          onLeaveToday,
          pendingLeave,
          openShiftsToday,
          openPayrollPeriods,
        ] = await Promise.all([
          prisma.hr_employee.count({
            where: { ...scope, status: { in: ["active", "on_leave"] } },
          }),
          prisma.hr_employee.count({
            where: { ...scope, status: "on_leave" },
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
          onLeaveToday,
          pendingLeave,
          openShiftsToday,
          openPayrollPeriods,
        };
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
          hireDate,
          wageType,
          baseSalaryETB,
          credentialUserId,
          credentialUserName,
          credentialPassword,
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
        let credId =
          credentialUserId != null ? Number(credentialUserId) : null;
        let credName = String(credentialUserName ?? "").trim();
        const password = String(credentialPassword ?? "");
        if (credName && password) {
          if (password.length < 6) {
            throw new Error("Password must be at least 6 characters");
          }
          const existingUser = await prisma.user.findUnique({
            where: { UserName: credName },
          });
          if (existingUser) {
            throw new Error(
              "Username already exists. Please choose a different username.",
            );
          }
          const orgTin =
            context.user.tinNumber != null &&
            String(context.user.tinNumber).trim() !== ""
              ? String(context.user.tinNumber).trim()
              : HotelName;
          const createdUser = await prisma.user.create({
            data: {
              UserName: credName,
              Password: await bcrypt.hash(password, 12),
              HotelName: context.user.HotelName || HotelName,
              tinNumber: orgTin,
              Role: "Employee",
              LogoUrl: context.user.LogoUrl || "",
              businessType: context.user.businessType || null,
            },
          });
          credId = createdUser.id;
        }

        const employee = await prisma.hr_employee.create({
          data: {
            HotelName,
            fullName: name,
            phone: String(phone ?? "").trim(),
            email: String(email ?? "").trim(),
            department: String(department ?? "").trim(),
            jobTitle: String(jobTitle ?? "").trim(),
            status: "active",
            hireDate: hd,
            wageType: wt,
            baseSalaryETB: round2(Number(baseSalaryETB) || 0),
            credentialUserId: credId,
            credentialUserName: credName,
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
          status,
          wageType,
          baseSalaryETB,
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
        if (status != null) {
          const s = String(status).trim();
          if (!EMPLOYEE_STATUSES.has(s)) throw new Error("Invalid employee status");
          data.status = s;
        }
        if (wageType != null) {
          const wt = String(wageType).trim();
          if (!WAGE_TYPES.has(wt)) throw new Error("Invalid wage type");
          data.wageType = wt;
        }
        if (baseSalaryETB != null) {
          data.baseSalaryETB = round2(Number(baseSalaryETB) || 0);
        }
        if (credentialUserId !== undefined) {
          data.credentialUserId =
            credentialUserId != null ? Number(credentialUserId) : null;
        }
        if (credentialUserName != null) {
          data.credentialUserName = String(credentialUserName).trim();
        }
        if (notes != null) data.notes = String(notes).trim();
        return prisma.hr_employee.update({
          where: { id: employee.id },
          data,
        });
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
        assertHrStaff(context);
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
        assertHrStaffOrEmployee(context);
        let targetId = Number(employeeId);
        if (isEmployeeActor(context)) {
          const mine = await requireLinkedEmployee(context);
          targetId = mine.id;
        }
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
        return prisma.hr_leave_request.create({
          data: {
            HotelName: employee.HotelName,
            employeeId: employee.id,
            leaveType: lt,
            fromYmd: from,
            toYmd: to,
            days: round2(d),
            reason: String(reason ?? "").trim(),
            status: "pending",
          },
        });
      },

      decideHrLeaveRequest: async (_, { id, approve }, context) => {
        assertHrAccess(context);
        const request = await prisma.hr_leave_request.findUnique({
          where: { id: Number(id) },
          include: { employee: true },
        });
        if (!request || !tenantHotelReadMatches(context, request.HotelName)) {
          throw new Error("Leave request not found");
        }
        if (request.status !== "pending") {
          throw new Error("Leave request already decided");
        }
        const { actorName } = actorFromContext(context);
        const nextStatus = approve ? "approved" : "rejected";

        await prisma.$transaction(async (tx) => {
          await tx.hr_leave_request.update({
            where: { id: request.id },
            data: {
              status: nextStatus,
              decidedBy: actorName,
              decidedAt: new Date(),
            },
          });

          const typeRow = await tx.hr_leave_type.findFirst({
            where: {
              HotelName: request.HotelName,
              code: request.leaveType,
            },
          });
          const deductPaid = typeRow
            ? Boolean(typeRow.paid)
            : ["annual", "sick"].includes(request.leaveType);
          if (approve && deductPaid) {
            const balance = await tx.hr_leave_balance.findUnique({
              where: {
                employeeId_leaveType: {
                  employeeId: request.employeeId,
                  leaveType: request.leaveType,
                },
              },
            });
            const nextBalance = round2(
              (balance ? Number(balance.balanceDays) : 0) - Number(request.days),
            );
            await tx.hr_leave_balance.upsert({
              where: {
                employeeId_leaveType: {
                  employeeId: request.employeeId,
                  leaveType: request.leaveType,
                },
              },
              create: {
                HotelName: request.HotelName,
                employeeId: request.employeeId,
                leaveType: request.leaveType,
                balanceDays: nextBalance,
              },
              update: { balanceDays: nextBalance },
            });
          }
        });

        return prisma.hr_leave_request.findUnique({
          where: { id: request.id },
          include: { employee: true },
        });
      },

      clockHrAttendance: async (_, { employeeId, action }, context) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, employeeId);
        const act = String(action ?? "").trim().toLowerCase();
        if (act !== "in" && act !== "out") {
          throw new Error("action must be 'in' or 'out'");
        }
        const workDate = todayYmd();
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
        let st = status != null ? String(status).trim() : undefined;
        if (st != null && !ATTENDANCE_STATUSES.has(st)) {
          throw new Error("Invalid attendance status");
        }
        const createData = {
          HotelName: employee.HotelName,
          employeeId: employee.id,
          workDate: wd,
          clockInAt: clockInAt != null ? new Date(clockInAt) : null,
          clockOutAt: clockOutAt != null ? new Date(clockOutAt) : null,
          status: st ?? "present",
          notes: String(notes ?? "").trim(),
        };
        const updateData = {};
        if (clockInAt !== undefined) {
          updateData.clockInAt = clockInAt != null ? new Date(clockInAt) : null;
        }
        if (clockOutAt !== undefined) {
          updateData.clockOutAt = clockOutAt != null ? new Date(clockOutAt) : null;
        }
        if (st != null) updateData.status = st;
        if (notes != null) updateData.notes = String(notes).trim();

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
        { periodKey, fromYmd, toYmd, notes },
        context,
      ) => {
        assertHrAccess(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const from = assertYmd(fromYmd, "fromYmd");
        const to = assertYmd(toYmd, "toYmd");
        if (to < from) throw new Error("toYmd must not be before fromYmd");
        const pk = String(periodKey ?? "").trim() || periodKeyFromYmd(from);
        return prisma.hr_payroll_period.create({
          data: {
            HotelName,
            periodKey: pk,
            fromYmd: from,
            toYmd: to,
            status: "open",
            notes: String(notes ?? "").trim(),
          },
        });
      },

      closeHrPayrollPeriod: async (_, { id }, context) => {
        assertHrAccess(context);
        const period = await prisma.hr_payroll_period.findUnique({
          where: { id: Number(id) },
        });
        if (!period || !tenantHotelReadMatches(context, period.HotelName)) {
          throw new Error("Payroll period not found");
        }
        if (period.status !== "open") {
          throw new Error("Payroll period already closed");
        }
        const { actorName } = actorFromContext(context);

        const employees = await prisma.hr_employee.findMany({
          where: { HotelName: period.HotelName, status: "active" },
        });

        await prisma.$transaction(async (tx) => {
          for (const employee of employees) {
            const basePayETB = round2(Number(employee.baseSalaryETB) || 0);
            const overtimeETB = 0;
            const tipsETB = 0;
            const deductionsETB = 0;
            const netPayETB = round2(
              basePayETB + overtimeETB + tipsETB - deductionsETB,
            );
            await tx.hr_payslip.upsert({
              where: {
                periodId_employeeId: {
                  periodId: period.id,
                  employeeId: employee.id,
                },
              },
              create: {
                HotelName: period.HotelName,
                periodId: period.id,
                employeeId: employee.id,
                basePayETB,
                overtimeETB,
                tipsETB,
                deductionsETB,
                netPayETB,
              },
              update: {
                basePayETB,
                overtimeETB,
                tipsETB,
                deductionsETB,
                netPayETB,
              },
            });
          }

          await tx.hr_payroll_period.update({
            where: { id: period.id },
            data: { status: "closed", closedAt: new Date(), closedBy: actorName },
          });
        });

        return prisma.hr_payroll_period.findUnique({ where: { id: period.id } });
      },

      upsertHrPayslip: async (
        _,
        {
          id,
          periodId,
          employeeId,
          basePayETB,
          overtimeETB,
          tipsETB,
          deductionsETB,
          notes,
        },
        context,
      ) => {
        assertHrAccess(context);
        const period = await prisma.hr_payroll_period.findUnique({
          where: { id: Number(periodId) },
        });
        if (!period || !tenantHotelReadMatches(context, period.HotelName)) {
          throw new Error("Payroll period not found");
        }
        const employee = await loadEmployeeInTenantOrThrow(context, employeeId);
        if (employee.HotelName !== period.HotelName) {
          throw new Error("Employee does not belong to this payroll period's tenant");
        }

        let existing = null;
        if (id != null) {
          existing = await prisma.hr_payslip.findUnique({
            where: { id: Number(id) },
          });
          if (!existing || !tenantHotelReadMatches(context, existing.HotelName)) {
            throw new Error("Payslip not found");
          }
        }

        const base = round2(
          Number(basePayETB ?? existing?.basePayETB ?? 0) || 0,
        );
        const ot = round2(
          Number(overtimeETB ?? existing?.overtimeETB ?? 0) || 0,
        );
        const tips = round2(Number(tipsETB ?? existing?.tipsETB ?? 0) || 0);
        const deductions = round2(
          Number(deductionsETB ?? existing?.deductionsETB ?? 0) || 0,
        );
        const netPayETB = round2(base + ot + tips - deductions);
        const payload = {
          basePayETB: base,
          overtimeETB: ot,
          tipsETB: tips,
          deductionsETB: deductions,
          netPayETB,
          notes: notes != null ? String(notes).trim() : existing?.notes ?? "",
        };

        return prisma.hr_payslip.upsert({
          where: {
            periodId_employeeId: {
              periodId: period.id,
              employeeId: employee.id,
            },
          },
          create: {
            HotelName: period.HotelName,
            periodId: period.id,
            employeeId: employee.id,
            ...payload,
          },
          update: payload,
        });
      },

      createHrIncident: async (
        _,
        { employeeId, kind, title, detail, occurredYmd, recordedBy },
        context,
      ) => {
        assertHrAccess(context);
        const employee = await loadEmployeeInTenantOrThrow(context, employeeId);
        const t = String(title ?? "").trim();
        if (!t) throw new Error("Incident title is required");
        let k = String(kind ?? "warning").trim();
        if (!INCIDENT_KINDS.has(k)) k = "warning";
        const occurred =
          occurredYmd != null && String(occurredYmd).trim() !== ""
            ? assertYmd(occurredYmd, "occurredYmd")
            : todayYmd();
        const { actorName } = actorFromContext(context);
        return prisma.hr_incident.create({
          data: {
            HotelName: employee.HotelName,
            employeeId: employee.id,
            kind: k,
            title: t,
            detail: String(detail ?? "").trim(),
            occurredYmd: occurred,
            recordedBy: String(recordedBy ?? actorName ?? "").trim(),
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
    },
  };
}
