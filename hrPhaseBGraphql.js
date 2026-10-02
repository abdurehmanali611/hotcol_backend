/**
 * HR Phase B GraphQL — statutory bands, library docs, templates, checklists,
 * payroll depth, career/discipline/training/benefits/assets, batch hire, bank export.
 */
import {
  assertNoStatBandOverlaps,
  assertStatBandShape,
} from "./hrStatutoryBands.js";
import { eachYmdInRange } from "./hrPayrollHelpers.js";
import { createHrNotification } from "./hrNotifications.js";

function requireTenant(context, tenantScopeFromContext) {
  const HotelName = tenantScopeFromContext(context);
  if (!HotelName) throw new Error("Tenant scope missing");
  return HotelName;
}

function actorFromContext(context) {
  const u = context?.user || {};
  const actorRole = String(u.Role || u.role || "").trim();
  const actorName = String(
    u.UserName || u.displayName || u.name || actorRole || "staff",
  ).trim();
  return { actorRole, actorName };
}

export const hrPhaseBTypeDefsBlock = `
  type HrPayrollStatBand {
    id: Int!
    HotelName: String!
    kind: String!
    label: String!
    ratePercent: Float!
    fromETB: Float!
    toETB: Float
    effectiveMode: String!
    fromYmd: String!
    toYmd: String!
    active: Boolean!
    sortOrder: Int!
  }

  input HrPayrollStatBandInput {
    kind: String!
    label: String
    ratePercent: Float!
    fromETB: Float!
    toETB: Float
    effectiveMode: String
    fromYmd: String
    toYmd: String
    active: Boolean
    sortOrder: Int
  }

  type HrLibraryDocument {
    id: Int!
    HotelName: String!
    title: String!
    description: String!
    fileSecureUrl: String!
    filePublicId: String!
    fileBytes: Int!
    fileFormat: String!
    fileOriginalName: String!
    uploadedBy: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type HrShiftTemplate {
    id: Int!
    HotelName: String!
    code: String!
    name: String!
    department: String!
    startTime: String!
    endTime: String!
    weekdayJson: String!
    notes: String!
    active: Boolean!
  }

  type HrChecklistTemplateItem {
    id: Int!
    label: String!
    required: Boolean!
    defaultOwner: String!
    sortOrder: Int!
  }

  type HrChecklistTemplate {
    id: Int!
    HotelName: String!
    kind: String!
    name: String!
    active: Boolean!
    items: [HrChecklistTemplateItem!]!
  }

  type HrChecklistRunItem {
    id: Int!
    label: String!
    required: Boolean!
    ownerRole: String!
    done: Boolean!
    completedBy: String!
    completedAt: DateTime
    note: String!
    sortOrder: Int!
  }

  type HrChecklistRun {
    id: Int!
    HotelName: String!
    templateId: Int!
    employeeId: Int!
    kind: String!
    status: String!
    items: [HrChecklistRunItem!]!
    createdAt: DateTime!
  }

  type HrSalaryHistory {
    id: Int!
    employeeId: Int!
    previousETB: Float!
    newETB: Float!
    reason: String!
    status: String!
    changedBy: String!
    decidedBy: String!
    createdAt: DateTime!
  }

  type HrAdvanceRequest {
    id: Int!
    employeeId: Int!
    amountETB: Float!
    reason: String!
    status: String!
    requestedBy: String!
    createdAt: DateTime!
  }

  type HrLoan {
    id: Int!
    employeeId: Int!
    principalETB: Float!
    remainingETB: Float!
    installmentETB: Float!
    reason: String!
    status: String!
    createdBy: String!
    createdAt: DateTime!
  }

  type HrBonus {
    id: Int!
    employeeId: Int!
    label: String!
    amountETB: Float!
    status: String!
    createdBy: String!
    createdAt: DateTime!
  }

  type HrOvertimeRequest {
    id: Int!
    employeeId: Int!
    workYmd: String!
    hours: Float!
    amountETB: Float!
    reason: String!
    status: String!
    requestedBy: String!
    createdAt: DateTime!
  }

  type HrCareerAction {
    id: Int!
    employeeId: Int!
    kind: String!
    detail: String!
    fromDept: String!
    toDept: String!
    fromTitle: String!
    toTitle: String!
    toOrgPosition: String!
    status: String!
    createdBy: String!
    createdAt: DateTime!
  }

  type HrDisciplinaryAction {
    id: Int!
    employeeId: Int!
    title: String!
    detail: String!
    status: String!
    createdBy: String!
    createdAt: DateTime!
  }

  type HrPerformanceReview {
    id: Int!
    employeeId: Int!
    periodLabel: String!
    rating: String!
    summary: String!
    status: String!
    createdBy: String!
    createdAt: DateTime!
  }

  type HrTrainingAssignment {
    id: Int!
    employeeId: Int!
    title: String!
    detail: String!
    dueYmd: String!
    status: String!
    createdBy: String!
    createdAt: DateTime!
  }

  type HrBenefitAssignment {
    id: Int!
    employeeId: Int!
    kind: String!
    label: String!
    amountETB: Float!
    status: String!
    createdBy: String!
    createdAt: DateTime!
  }

  type HrAsset {
    id: Int!
    employeeId: Int
    label: String!
    serialNo: String!
    status: String!
    issuedYmd: String!
    returnedYmd: String!
    notes: String!
    createdBy: String!
    createdAt: DateTime!
  }

  type HrBankExportRow {
    payslipId: Int!
    employeeId: Int!
    employeeName: String!
    bankName: String!
    accountNumber: String!
    netPayETB: Float!
    payslipNumber: String!
  }

  input HrEmployeeBatchInput {
    fullName: String!
    phone: String
    email: String
    department: String
    jobTitle: String
    orgPosition: String
    teamId: Int
    wageType: String
    baseSalaryETB: Float
    hireDate: String
    gender: String
    education: String
    personalTin: String
    yearsExperience: Int
    bankName: String
    accountNumber: String
    notes: String
    medicalNote: String
  }

  input HrShiftTemplateInput {
    id: Int
    code: String!
    name: String!
    department: String
    startTime: String
    endTime: String
    weekdayJson: String
    notes: String
    active: Boolean
  }

  input HrChecklistTemplateItemInput {
    label: String!
    required: Boolean
    defaultOwner: String
    sortOrder: Int
  }
`;

export const hrPhaseBQueryFields = `
    hrPayrollStatBands: [HrPayrollStatBand!]!
    hrLibraryDocuments: [HrLibraryDocument!]!
    hrShiftTemplates: [HrShiftTemplate!]!
    hrChecklistTemplates(kind: String): [HrChecklistTemplate!]!
    hrChecklistRuns(employeeId: Int, kind: String): [HrChecklistRun!]!
    hrSalaryHistory(employeeId: Int): [HrSalaryHistory!]!
    hrAdvanceRequests(status: String): [HrAdvanceRequest!]!
    hrLoans(status: String): [HrLoan!]!
    hrBonuses(status: String): [HrBonus!]!
    hrOvertimeRequests(status: String): [HrOvertimeRequest!]!
    hrCareerActions(status: String): [HrCareerAction!]!
    hrDisciplinaryActions(status: String): [HrDisciplinaryAction!]!
    hrPerformanceReviews(status: String): [HrPerformanceReview!]!
    hrTrainingAssignments(status: String): [HrTrainingAssignment!]!
    hrBenefitAssignments(status: String): [HrBenefitAssignment!]!
    hrAssets(status: String): [HrAsset!]!
    hrPayrollBankExport(periodId: Int!): [HrBankExportRow!]!
`;

export const hrPhaseBMutationFields = `
    replaceHrPayrollStatBands(bands: [HrPayrollStatBandInput!]!): [HrPayrollStatBand!]!
    createHrLibraryDocument(
      title: String!
      description: String
      fileSecureUrl: String!
      filePublicId: String
      fileBytes: Int
      fileFormat: String
      fileOriginalName: String
    ): HrLibraryDocument!
    updateHrLibraryDocument(
      id: Int!
      title: String!
      description: String
      fileSecureUrl: String
      filePublicId: String
      fileBytes: Int
      fileFormat: String
      fileOriginalName: String
    ): HrLibraryDocument!
    deleteHrLibraryDocument(id: Int!): Boolean!
    upsertHrShiftTemplate(input: HrShiftTemplateInput!): HrShiftTemplate!
    deleteHrShiftTemplate(id: Int!): Boolean!
    applyHrShiftTemplate(
      templateId: Int!
      employeeIds: [Int!]!
      fromYmd: String!
      toYmd: String!
    ): Int!
    saveHrChecklistTemplate(
      id: Int
      kind: String!
      name: String!
      active: Boolean
      items: [HrChecklistTemplateItemInput!]!
    ): HrChecklistTemplate!
    deleteHrChecklistTemplate(id: Int!): Boolean!
    startHrChecklistRun(employeeId: Int!, kind: String!): HrChecklistRun!
    toggleHrChecklistRunItem(id: Int!, done: Boolean!, note: String): HrChecklistRunItem!
    completeHrChecklistRun(id: Int!): HrChecklistRun!
    approveHrChecklistRun(id: Int!, approve: Boolean!): HrChecklistRun!
    requestHrSalaryChange(employeeId: Int!, newETB: Float!, reason: String): HrSalaryHistory!
    decideHrSalaryChange(id: Int!, approve: Boolean!): HrSalaryHistory!
    createHrAdvanceRequest(employeeId: Int!, amountETB: Float!, reason: String): HrAdvanceRequest!
    decideHrAdvanceRequest(id: Int!, approve: Boolean!): HrAdvanceRequest!
    createHrLoan(employeeId: Int!, principalETB: Float!, installmentETB: Float, reason: String): HrLoan!
    decideHrLoan(id: Int!, approve: Boolean!): HrLoan!
    createHrBonus(employeeId: Int!, label: String!, amountETB: Float!): HrBonus!
    decideHrBonus(id: Int!, approve: Boolean!): HrBonus!
    createHrOvertimeRequest(employeeId: Int!, workYmd: String!, hours: Float!, amountETB: Float, reason: String): HrOvertimeRequest!
    decideHrOvertimeRequest(id: Int!, approve: Boolean!): HrOvertimeRequest!
    createHrCareerAction(
      employeeId: Int!
      kind: String!
      detail: String
      fromDept: String
      toDept: String
      fromTitle: String
      toTitle: String
      toOrgPosition: String
    ): HrCareerAction!
    decideHrCareerAction(id: Int!, approve: Boolean!): HrCareerAction!
    createHrDisciplinaryAction(employeeId: Int!, title: String!, detail: String): HrDisciplinaryAction!
    decideHrDisciplinaryAction(id: Int!, approve: Boolean!): HrDisciplinaryAction!
    createHrPerformanceReview(employeeId: Int!, periodLabel: String, rating: String, summary: String): HrPerformanceReview!
    finalizeHrPerformanceReview(id: Int!, approve: Boolean!): HrPerformanceReview!
    createHrTrainingAssignment(employeeId: Int!, title: String!, detail: String, dueYmd: String): HrTrainingAssignment!
    decideHrTrainingAssignment(id: Int!, approve: Boolean!): HrTrainingAssignment!
    createHrBenefitAssignment(employeeId: Int!, kind: String!, label: String!, amountETB: Float): HrBenefitAssignment!
    decideHrBenefitAssignment(id: Int!, approve: Boolean!): HrBenefitAssignment!
    createHrAsset(label: String!, serialNo: String, notes: String): HrAsset!
    issueHrAsset(id: Int!, employeeId: Int!, issuedYmd: String): HrAsset!
    returnHrAsset(id: Int!, returnedYmd: String): HrAsset!
    createHrEmployeesBatch(employees: [HrEmployeeBatchInput!]!): [HrEmployee!]!
`;

function decidePending(row, approve, actorName, appliedStatus = "approved") {
  if (!row) throw new Error("Record not found");
  if (row.status !== "pending" && row.status !== "draft" && row.status !== "awaiting_manager") {
    throw new Error("Record is not awaiting decision");
  }
  return {
    status: approve ? appliedStatus : "rejected",
    decidedBy: actorName,
    decidedAt: new Date(),
  };
}

export function createHrPhaseBResolvers({
  prisma,
  tenantScopeFromContext,
  assertRole,
}) {
  const assertHrOrManager = (ctx) => assertRole(ctx, ["HR", "Manager", "Admin"]);
  const assertManager = (ctx) => assertRole(ctx, ["Manager", "Admin"]);
  const assertHr = (ctx) => assertRole(ctx, ["HR", "Admin"]);

  async function listByHotel(model, HotelName, extra = {}) {
    return prisma[model].findMany({
      where: { HotelName, ...extra },
      orderBy: { createdAt: "desc" },
    });
  }

  return {
    Query: {
      hrPayrollStatBands: async (_, __, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return prisma.hr_payroll_stat_band.findMany({
          where: { HotelName },
          orderBy: [{ kind: "asc" }, { fromETB: "asc" }],
        });
      },
      hrLibraryDocuments: async (_, __, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_library_document", HotelName);
      },
      hrShiftTemplates: async (_, __, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return prisma.hr_shift_template.findMany({
          where: { HotelName },
          orderBy: { name: "asc" },
        });
      },
      hrChecklistTemplates: async (_, { kind }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const where = { HotelName };
        if (kind) where.kind = String(kind);
        return prisma.hr_checklist_template.findMany({
          where,
          include: { items: { orderBy: { sortOrder: "asc" } } },
          orderBy: { name: "asc" },
        });
      },
      hrChecklistRuns: async (_, { employeeId, kind }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const where = { HotelName };
        if (employeeId) where.employeeId = Number(employeeId);
        if (kind) where.kind = String(kind);
        return prisma.hr_checklist_run.findMany({
          where,
          include: { items: { orderBy: { sortOrder: "asc" } } },
          orderBy: { createdAt: "desc" },
        });
      },
      hrSalaryHistory: async (_, { employeeId }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const where = { HotelName };
        if (employeeId) where.employeeId = Number(employeeId);
        return prisma.hr_salary_history.findMany({
          where,
          orderBy: { createdAt: "desc" },
        });
      },
      hrAdvanceRequests: async (_, { status }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_advance_request", HotelName, status ? { status } : {});
      },
      hrLoans: async (_, { status }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_loan", HotelName, status ? { status } : {});
      },
      hrBonuses: async (_, { status }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_bonus", HotelName, status ? { status } : {});
      },
      hrOvertimeRequests: async (_, { status }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_overtime_request", HotelName, status ? { status } : {});
      },
      hrCareerActions: async (_, { status }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_career_action", HotelName, status ? { status } : {});
      },
      hrDisciplinaryActions: async (_, { status }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_disciplinary_action", HotelName, status ? { status } : {});
      },
      hrPerformanceReviews: async (_, { status }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_performance_review", HotelName, status ? { status } : {});
      },
      hrTrainingAssignments: async (_, { status }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_training_assignment", HotelName, status ? { status } : {});
      },
      hrBenefitAssignments: async (_, { status }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_benefit_assignment", HotelName, status ? { status } : {});
      },
      hrAssets: async (_, { status }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return listByHotel("hr_asset", HotelName, status ? { status } : {});
      },
      hrPayrollBankExport: async (_, { periodId }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const period = await prisma.hr_payroll_period.findFirst({
          where: { id: Number(periodId), HotelName },
        });
        if (!period) throw new Error("Payroll period not found");
        const slips = await prisma.hr_payslip.findMany({
          where: {
            periodId: period.id,
            HotelName,
            paymentStatus: { in: ["marked_paid", "approved", "awaiting_finance", "unpaid"] },
          },
          orderBy: { employeeName: "asc" },
        });
        return slips
          .filter((s) => {
            const bank = String(s.bankName ?? "").trim();
            const account = String(s.accountNumber ?? "").trim();
            return Boolean(bank && account);
          })
          .map((s) => ({
          payslipId: s.id,
          employeeId: s.employeeId,
          employeeName: s.employeeName,
          bankName: s.bankName || "",
          accountNumber: s.accountNumber || "",
          netPayETB: s.netPayETB,
          payslipNumber: s.payslipNumber,
        }));
      },
    },
    Mutation: {
      replaceHrPayrollStatBands: async (_, { bands }, context) => {
        assertManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const shaped = assertNoStatBandOverlaps(bands || []);
        await prisma.$transaction(async (tx) => {
          await tx.hr_payroll_stat_band.deleteMany({ where: { HotelName } });
          if (shaped.length) {
            await tx.hr_payroll_stat_band.createMany({
              data: shaped.map((b, i) => ({
                HotelName,
                ...b,
                sortOrder: b.sortOrder || i,
              })),
            });
          }
        });
        return prisma.hr_payroll_stat_band.findMany({
          where: { HotelName },
          orderBy: [{ kind: "asc" }, { fromETB: "asc" }],
        });
      },
      createHrLibraryDocument: async (
        _,
        {
          title,
          description,
          fileSecureUrl,
          filePublicId,
          fileBytes,
          fileFormat,
          fileOriginalName,
        },
        context,
      ) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        const t = String(title || "").trim();
        const url = String(fileSecureUrl || "").trim();
        if (!t) throw new Error("Title is required");
        if (!url) throw new Error("Uploaded file URL is required");
        return prisma.hr_library_document.create({
          data: {
            HotelName,
            title: t,
            description: String(description || "").trim(),
            fileSecureUrl: url,
            filePublicId: String(filePublicId || "").trim(),
            fileBytes: Number(fileBytes) || 0,
            fileFormat: String(fileFormat || "").trim(),
            fileOriginalName: String(fileOriginalName || "").trim(),
            uploadedBy: actorName,
          },
        });
      },
      updateHrLibraryDocument: async (
        _,
        {
          id,
          title,
          description,
          fileSecureUrl,
          filePublicId,
          fileBytes,
          fileFormat,
          fileOriginalName,
        },
        context,
      ) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_library_document.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!row) throw new Error("Document not found");
        const t = String(title || "").trim();
        if (!t) throw new Error("Title is required");
        const data = {
          title: t,
          description: String(description || "").trim(),
        };
        const url = fileSecureUrl != null ? String(fileSecureUrl).trim() : "";
        if (url) {
          data.fileSecureUrl = url;
          if (filePublicId != null) {
            data.filePublicId = String(filePublicId || "").trim();
          }
          if (fileBytes != null) data.fileBytes = Number(fileBytes) || 0;
          if (fileFormat != null) {
            data.fileFormat = String(fileFormat || "").trim();
          }
          if (fileOriginalName != null) {
            data.fileOriginalName = String(fileOriginalName || "").trim();
          }
        }
        return prisma.hr_library_document.update({
          where: { id: row.id },
          data,
        });
      },
      deleteHrLibraryDocument: async (_, { id }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_library_document.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!row) throw new Error("Document not found");
        await prisma.hr_library_document.delete({ where: { id: row.id } });
        return true;
      },
      upsertHrShiftTemplate: async (_, { input }, context) => {
        assertManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const code = String(input.code || "").trim();
        const name = String(input.name || "").trim();
        if (!code || !name) throw new Error("code and name are required");
        const data = {
          HotelName,
          code,
          name,
          department: String(input.department || "").trim(),
          startTime: String(input.startTime || "").trim(),
          endTime: String(input.endTime || "").trim(),
          weekdayJson: String(input.weekdayJson || "[]"),
          notes: String(input.notes || "").trim(),
          active: input.active !== false,
        };
        if (input.id) {
          return prisma.hr_shift_template.update({
            where: { id: Number(input.id) },
            data,
          });
        }
        return prisma.hr_shift_template.create({ data });
      },
      deleteHrShiftTemplate: async (_, { id }, context) => {
        assertManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_shift_template.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!row) throw new Error("Template not found");
        await prisma.hr_shift_template.delete({ where: { id: row.id } });
        return true;
      },
      applyHrShiftTemplate: async (
        _,
        { templateId, employeeIds, fromYmd, toYmd },
        context,
      ) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const tpl = await prisma.hr_shift_template.findFirst({
          where: { id: Number(templateId), HotelName, active: true },
        });
        if (!tpl) throw new Error("Template not found");
        let weekdays = [];
        try {
          weekdays = JSON.parse(tpl.weekdayJson || "[]");
        } catch {
          weekdays = [];
        }
        const ids = (employeeIds || []).map(Number).filter((n) => n > 0);
        if (!ids.length) throw new Error("Select at least one employee");
        const days = eachYmdInRange(fromYmd, toYmd);
        let created = 0;
        for (const ymd of days) {
          const [y, m, d] = ymd.split("-").map(Number);
          const dow = new Date(y, m - 1, d).getDay(); // 0 Sun
          if (weekdays.length && !weekdays.includes(dow) && !weekdays.includes(String(dow))) {
            continue;
          }
          for (const employeeId of ids) {
            await prisma.hr_shift.create({
              data: {
                HotelName,
                employeeId,
                workDate: ymd,
                startTime: tpl.startTime || "09:00",
                endTime: tpl.endTime || "17:00",
                department: tpl.department || "",
                notes: `template:${tpl.code}`,
              },
            });
            created += 1;
          }
        }
        return created;
      },
      saveHrChecklistTemplate: async (
        _,
        { id, kind, name, active, items },
        context,
      ) => {
        assertManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const k = String(kind || "").trim();
        if (k !== "onboarding" && k !== "exit") {
          throw new Error("kind must be onboarding or exit");
        }
        const itemRows = (items || []).map((it, i) => ({
          label: String(it.label || "").trim(),
          required: it.required !== false,
          defaultOwner: String(it.defaultOwner || "HR").trim() || "HR",
          sortOrder: Number(it.sortOrder) || i,
        })).filter((it) => it.label);
        if (!itemRows.length) throw new Error("Add at least one checklist item");

        return prisma.$transaction(async (tx) => {
          let template;
          if (id) {
            template = await tx.hr_checklist_template.update({
              where: { id: Number(id) },
              data: {
                name: String(name || "").trim() || k,
                active: active !== false,
                kind: k,
              },
            });
            await tx.hr_checklist_template_item.deleteMany({
              where: { templateId: template.id },
            });
          } else {
            template = await tx.hr_checklist_template.create({
              data: {
                HotelName,
                kind: k,
                name: String(name || "").trim() || k,
                active: active !== false,
              },
            });
          }
          await tx.hr_checklist_template_item.createMany({
            data: itemRows.map((it) => ({ ...it, templateId: template.id })),
          });
          return tx.hr_checklist_template.findUnique({
            where: { id: template.id },
            include: { items: { orderBy: { sortOrder: "asc" } } },
          });
        });
      },
      deleteHrChecklistTemplate: async (_, { id }, context) => {
        assertManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_checklist_template.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!row) throw new Error("Checklist template not found");
        const runCount = await prisma.hr_checklist_run.count({
          where: { templateId: row.id, HotelName },
        });
        if (runCount > 0) {
          throw new Error(
            "Cannot delete a template that already has checklist runs. Edit it instead.",
          );
        }
        await prisma.hr_checklist_template.delete({ where: { id: row.id } });
        return true;
      },
      startHrChecklistRun: async (_, { employeeId, kind }, context) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const k = String(kind || "").trim();
        const template = await prisma.hr_checklist_template.findFirst({
          where: { HotelName, kind: k, active: true },
          include: { items: { orderBy: { sortOrder: "asc" } } },
          orderBy: { updatedAt: "desc" },
        });
        if (!template?.items?.length) {
          throw new Error(`No active ${k} checklist template`);
        }
        const emp = await prisma.hr_employee.findFirst({
          where: { id: Number(employeeId), HotelName },
        });
        if (!emp) throw new Error("Employee not found");
        return prisma.$transaction(async (tx) => {
          const run = await tx.hr_checklist_run.create({
            data: {
              HotelName,
              templateId: template.id,
              employeeId: emp.id,
              kind: k,
              status: "open",
            },
          });
          await tx.hr_checklist_run_item.createMany({
            data: template.items.map((it) => ({
              runId: run.id,
              label: it.label,
              required: it.required,
              ownerRole: it.defaultOwner,
              sortOrder: it.sortOrder,
            })),
          });
          return tx.hr_checklist_run.findUnique({
            where: { id: run.id },
            include: { items: { orderBy: { sortOrder: "asc" } } },
          });
        });
      },
      toggleHrChecklistRunItem: async (_, { id, done, note }, context) => {
        assertHr(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const item = await prisma.hr_checklist_run_item.findUnique({
          where: { id: Number(id) },
          include: { run: true },
        });
        if (!item || item.run.HotelName !== HotelName) {
          throw new Error("Checklist item not found");
        }
        return prisma.hr_checklist_run_item.update({
          where: { id: item.id },
          data: {
            done: Boolean(done),
            note: String(note || item.note || "").trim(),
            completedBy: done ? actorName : "",
            completedAt: done ? new Date() : null,
          },
        });
      },
      completeHrChecklistRun: async (_, { id }, context) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const run = await prisma.hr_checklist_run.findFirst({
          where: { id: Number(id), HotelName },
          include: { items: true },
        });
        if (!run) throw new Error("Checklist run not found");
        const missing = run.items.filter((i) => i.required && !i.done);
        if (missing.length) {
          throw new Error("Complete all required checklist items first");
        }
        if (run.kind === "exit") {
          return prisma.hr_checklist_run.update({
            where: { id: run.id },
            data: { status: "awaiting_manager" },
            include: { items: { orderBy: { sortOrder: "asc" } } },
          });
        }
        return prisma.hr_checklist_run.update({
          where: { id: run.id },
          data: { status: "completed", completedAt: new Date() },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
      },
      approveHrChecklistRun: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const run = await prisma.hr_checklist_run.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!run || run.status !== "awaiting_manager") {
          throw new Error("Checklist is not awaiting Manager approval");
        }
        return prisma.hr_checklist_run.update({
          where: { id: run.id },
          data: {
            status: approve ? "closed" : "open",
            decidedBy: actorName,
            decidedAt: new Date(),
            completedAt: approve ? new Date() : null,
          },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
      },
      requestHrSalaryChange: async (_, { employeeId, newETB, reason }, context) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        const emp = await prisma.hr_employee.findFirst({
          where: { id: Number(employeeId), HotelName },
        });
        if (!emp) throw new Error("Employee not found");
        const row = await prisma.hr_salary_history.create({
          data: {
            HotelName,
            employeeId: emp.id,
            previousETB: emp.baseSalaryETB,
            newETB: Number(newETB) || 0,
            reason: String(reason || "").trim(),
            changedBy: actorName,
            status: "pending",
          },
        });
        await createHrNotification(prisma, {
          HotelName,
          recipientRole: "Manager",
          kind: "salary_change_pending",
          title: "Salary change needs approval",
          body: `${actorName} requested salary change for ${emp.fullName}.`,
          href: `/Manager?section=hr-employees`,
          actionStatus: "pending",
          createdBy: actorName,
        }).catch(() => {});
        return row;
      },
      decideHrSalaryChange: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_salary_history.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!row || row.status !== "pending") throw new Error("Salary change not pending");
        if (!approve) {
          return prisma.hr_salary_history.update({
            where: { id: row.id },
            data: decidePending(row, false, actorName),
          });
        }
        return prisma.$transaction(async (tx) => {
          await tx.hr_employee.update({
            where: { id: row.employeeId },
            data: { baseSalaryETB: row.newETB },
          });
          return tx.hr_salary_history.update({
            where: { id: row.id },
            data: decidePending(row, true, actorName, "applied"),
          });
        });
      },
      createHrAdvanceRequest: async (_, { employeeId, amountETB, reason }, context) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        return prisma.hr_advance_request.create({
          data: {
            HotelName,
            employeeId: Number(employeeId),
            amountETB: Number(amountETB) || 0,
            reason: String(reason || "").trim(),
            status: "pending",
            requestedBy: actorName,
          },
        });
      },
      decideHrAdvanceRequest: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_advance_request.findFirst({
          where: { id: Number(id), HotelName },
        });
        return prisma.hr_advance_request.update({
          where: { id: row.id },
          data: decidePending(row, approve, actorName, "approved"),
        });
      },
      createHrLoan: async (_, { employeeId, principalETB, installmentETB, reason }, context) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        const principal = Number(principalETB) || 0;
        return prisma.hr_loan.create({
          data: {
            HotelName,
            employeeId: Number(employeeId),
            principalETB: principal,
            remainingETB: principal,
            installmentETB: Number(installmentETB) || 0,
            reason: String(reason || "").trim(),
            status: "pending",
            createdBy: actorName,
          },
        });
      },
      decideHrLoan: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_loan.findFirst({
          where: { id: Number(id), HotelName },
        });
        return prisma.hr_loan.update({
          where: { id: row.id },
          data: {
            ...decidePending(row, approve, actorName, "active"),
            // Ensure approved loans always have a positive installment for payroll.
            ...(approve
              ? {
                  installmentETB:
                    Number(row.installmentETB) > 0
                      ? Number(row.installmentETB)
                      : Number(row.remainingETB) || Number(row.principalETB) || 0,
                  remainingETB:
                    Number(row.remainingETB) > 0
                      ? Number(row.remainingETB)
                      : Number(row.principalETB) || 0,
                }
              : {}),
          },
        });
      },
      createHrBonus: async (_, { employeeId, label, amountETB }, context) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        return prisma.hr_bonus.create({
          data: {
            HotelName,
            employeeId: Number(employeeId),
            label: String(label || "").trim(),
            amountETB: Number(amountETB) || 0,
            status: "pending",
            createdBy: actorName,
          },
        });
      },
      decideHrBonus: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_bonus.findFirst({
          where: { id: Number(id), HotelName },
        });
        return prisma.hr_bonus.update({
          where: { id: row.id },
          data: decidePending(row, approve, actorName, "approved"),
        });
      },
      createHrOvertimeRequest: async (
        _,
        { employeeId, workYmd, hours, amountETB, reason },
        context,
      ) => {
        assertHrOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        return prisma.hr_overtime_request.create({
          data: {
            HotelName,
            employeeId: Number(employeeId),
            workYmd: String(workYmd || "").trim(),
            hours: Number(hours) || 0,
            amountETB: Number(amountETB) || 0,
            reason: String(reason || "").trim(),
            status: "pending",
            requestedBy: actorName,
          },
        });
      },
      decideHrOvertimeRequest: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_overtime_request.findFirst({
          where: { id: Number(id), HotelName },
        });
        return prisma.hr_overtime_request.update({
          where: { id: row.id },
          data: decidePending(row, approve, actorName, "approved"),
        });
      },
      createHrCareerAction: async (
        _,
        {
          employeeId,
          kind,
          detail,
          fromDept,
          toDept,
          fromTitle,
          toTitle,
          toOrgPosition,
        },
        context,
      ) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        const k = String(kind || "").trim();
        if (k !== "promotion" && k !== "transfer") {
          throw new Error("kind must be promotion or transfer");
        }
        const pos =
          String(toOrgPosition || "employee").trim().toLowerCase() === "leader"
            ? "leader"
            : "employee";
        return prisma.hr_career_action.create({
          data: {
            HotelName,
            employeeId: Number(employeeId),
            kind: k,
            detail: String(detail || "").trim(),
            fromDept: String(fromDept || "").trim(),
            toDept: String(toDept || "").trim(),
            fromTitle: String(fromTitle || "").trim(),
            toTitle: String(toTitle || "").trim(),
            toOrgPosition: pos,
            status: "pending",
            createdBy: actorName,
          },
        });
      },
      decideHrCareerAction: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_career_action.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!approve) {
          return prisma.hr_career_action.update({
            where: { id: row.id },
            data: decidePending(row, false, actorName),
          });
        }
        return prisma.$transaction(async (tx) => {
          const data = {};
          if (row.toDept) data.department = row.toDept;
          if (row.toTitle) data.jobTitle = row.toTitle;
          const pos = String(row.toOrgPosition || "").trim().toLowerCase();
          if (pos === "leader" || pos === "employee") {
            data.orgPosition = pos;
          }
          if (Object.keys(data).length) {
            await tx.hr_employee.update({
              where: { id: row.employeeId },
              data,
            });
          }
          return tx.hr_career_action.update({
            where: { id: row.id },
            data: decidePending(row, true, actorName, "applied"),
          });
        });
      },
      createHrDisciplinaryAction: async (_, { employeeId, title, detail }, context) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        return prisma.hr_disciplinary_action.create({
          data: {
            HotelName,
            employeeId: Number(employeeId),
            title: String(title || "").trim(),
            detail: String(detail || "").trim(),
            status: "pending",
            createdBy: actorName,
          },
        });
      },
      decideHrDisciplinaryAction: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_disciplinary_action.findFirst({
          where: { id: Number(id), HotelName },
        });
        return prisma.hr_disciplinary_action.update({
          where: { id: row.id },
          data: decidePending(row, approve, actorName, "recorded"),
        });
      },
      createHrPerformanceReview: async (
        _,
        { employeeId, periodLabel, rating, summary },
        context,
      ) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        return prisma.hr_performance_review.create({
          data: {
            HotelName,
            employeeId: Number(employeeId),
            periodLabel: String(periodLabel || "").trim(),
            rating: String(rating || "").trim(),
            summary: String(summary || "").trim(),
            status: "pending",
            createdBy: actorName,
          },
        });
      },
      finalizeHrPerformanceReview: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_performance_review.findFirst({
          where: { id: Number(id), HotelName },
        });
        return prisma.hr_performance_review.update({
          where: { id: row.id },
          data: decidePending(row, approve, actorName, "finalized"),
        });
      },
      createHrTrainingAssignment: async (
        _,
        { employeeId, title, detail, dueYmd },
        context,
      ) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        return prisma.hr_training_assignment.create({
          data: {
            HotelName,
            employeeId: Number(employeeId),
            title: String(title || "").trim(),
            detail: String(detail || "").trim(),
            dueYmd: String(dueYmd || "").trim(),
            status: "pending",
            createdBy: actorName,
          },
        });
      },
      decideHrTrainingAssignment: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_training_assignment.findFirst({
          where: { id: Number(id), HotelName },
        });
        return prisma.hr_training_assignment.update({
          where: { id: row.id },
          data: decidePending(row, approve, actorName, "approved"),
        });
      },
      createHrBenefitAssignment: async (
        _,
        { employeeId, kind, label, amountETB },
        context,
      ) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        return prisma.hr_benefit_assignment.create({
          data: {
            HotelName,
            employeeId: Number(employeeId),
            kind: String(kind || "other").trim(),
            label: String(label || "").trim(),
            amountETB: Number(amountETB) || 0,
            status: "pending",
            createdBy: actorName,
          },
        });
      },
      decideHrBenefitAssignment: async (_, { id, approve }, context) => {
        assertManager(context);
        const { actorName } = actorFromContext(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_benefit_assignment.findFirst({
          where: { id: Number(id), HotelName },
        });
        return prisma.hr_benefit_assignment.update({
          where: { id: row.id },
          data: decidePending(row, approve, actorName, "active"),
        });
      },
      createHrAsset: async (_, { label, serialNo, notes }, context) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        return prisma.hr_asset.create({
          data: {
            HotelName,
            label: String(label || "").trim(),
            serialNo: String(serialNo || "").trim(),
            notes: String(notes || "").trim(),
            status: "available",
            createdBy: actorName,
          },
        });
      },
      issueHrAsset: async (_, { id, employeeId, issuedYmd }, context) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_asset.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!row || row.status !== "available") throw new Error("Asset not available");
        return prisma.hr_asset.update({
          where: { id: row.id },
          data: {
            employeeId: Number(employeeId),
            status: "issued",
            issuedYmd: String(issuedYmd || "").trim(),
            returnedYmd: "",
          },
        });
      },
      returnHrAsset: async (_, { id, returnedYmd }, context) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const row = await prisma.hr_asset.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!row) throw new Error("Asset not found");
        return prisma.hr_asset.update({
          where: { id: row.id },
          data: {
            status: "returned",
            returnedYmd: String(returnedYmd || "").trim(),
            employeeId: null,
          },
        });
      },
      createHrEmployeesBatch: async (_, { employees }, context) => {
        assertHr(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const rows = (employees || [])
          .map((e) => ({
            HotelName,
            fullName: String(e.fullName || "").trim(),
            phone: String(e.phone || "").trim(),
            email: String(e.email || "").trim(),
            department: String(e.department || "").trim(),
            jobTitle: String(e.jobTitle || "").trim(),
            orgPosition:
              String(e.orgPosition || "").trim() === "leader"
                ? "leader"
                : "employee",
            teamId:
              e.teamId != null && Number(e.teamId) > 0
                ? Number(e.teamId)
                : null,
            wageType: String(e.wageType || "monthly").trim() || "monthly",
            baseSalaryETB: Number(e.baseSalaryETB) || 0,
            hireDate: String(e.hireDate || "").trim(),
            gender: String(e.gender || "").trim(),
            education: String(e.education || "").trim(),
            personalTin: String(e.personalTin || "").trim(),
            yearsExperience: Math.max(
              0,
              Math.min(80, Math.floor(Number(e.yearsExperience) || 0)),
            ),
            bankName: String(e.bankName || "").trim(),
            accountNumber: String(e.accountNumber || "").trim(),
            notes: String(e.notes || "").trim(),
            medicalNote: String(e.medicalNote || "").trim(),
            status: "active",
          }))
          .filter((e) => e.fullName);
        if (!rows.length) throw new Error("No valid employees in batch");
        await prisma.hr_employee.createMany({ data: rows });
        return prisma.hr_employee.findMany({
          where: {
            HotelName,
            fullName: { in: rows.map((r) => r.fullName) },
          },
          orderBy: { id: "desc" },
          take: rows.length,
        });
      },
    },
  };
}
