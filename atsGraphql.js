/**
 * ATS GraphQL — access OTPs (Manager in hotcol-user), public Candidate APIs,
 * Admin unlock + vacancies/applications (hotcol-ats).
 */
import jwt from "jsonwebtoken";
import {
  assertAtsRole,
  findAtsAccessByOtp,
  issueUniqueAtsAccessOtp,
  normalizeAtsRole,
} from "./atsPortalOtp.js";
import { issueUniquePortalOtp } from "./hrPortalOtp.js";

const VACANCY_STATUSES = new Set(["draft", "open", "closed"]);
const APPLICATION_STATUSES = new Set([
  "applied",
  "screening",
  "interview",
  "offer",
  "offer_accepted",
  "rejected",
  "withdrawn",
]);

const ATS_ADMIN_TOKEN_KIND = "ats_admin";
const ATS_ADMIN_TTL = "12h";

export const atsTypeDefsBlock = `
  type AtsAccessOtp {
    id: Int!
    tinNumber: String!
    HotelName: String!
    role: String!
    """True when a code is configured (hash present)."""
    hasCode: Boolean!
    updatedBy: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    """Plaintext only immediately after Get OTP / Save — otherwise empty."""
    otpPreview: String!
  }

  type AtsTenantPublic {
    tinNumber: String!
    displayName: String!
  }

  type AtsVacancy {
    id: Int!
    tinNumber: String!
    HotelName: String!
    title: String!
    description: String!
    department: String!
    status: String!
    createdByRole: String!
    updatedByRole: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type AtsApplication {
    id: Int!
    vacancyId: Int!
    tinNumber: String!
    HotelName: String!
    fullName: String!
    phone: String!
    email: String!
    coverNote: String!
    cvSecureUrl: String!
    cvPublicId: String!
    cvBytes: Int!
    cvFormat: String!
    cvOriginalFilename: String!
    status: String!
    updatedByRole: String!
    employeeId: Int
    createdAt: DateTime!
    updatedAt: DateTime!
    vacancy: AtsVacancy
  }

  type AtsAdminSession {
    token: String!
    tinNumber: String!
    HotelName: String!
    role: String!
    displayName: String!
  }

  """Offer → hire handoff (F40): creates HR employee + portal OTP."""
  type HireAtsApplicationResult {
    application: AtsApplication!
    """Plaintext hire OTP — shown once; not stored for ATS re-read."""
    portalOtpPreview: String!
    employeeId: Int!
  }
`;

export const atsQueryFields = `
    atsAccessOtps: [AtsAccessOtp!]!
    atsTenantPublic(tin: String!): AtsTenantPublic
    atsOpenVacancies(tin: String!): [AtsVacancy!]!
    atsVacancyPublic(tin: String!, id: Int!): AtsVacancy
    atsAdminVacancies: [AtsVacancy!]!
    atsAdminApplications(vacancyId: Int, status: String): [AtsApplication!]!
    atsAdminMe: AtsAdminSession
`;

export const atsMutationFields = `
    upsertAtsAccessOtp(role: String!): AtsAccessOtp!
    atsAdminUnlock(otp: String!): AtsAdminSession!
    createAtsVacancy(title: String!, description: String, department: String, status: String): AtsVacancy!
    updateAtsVacancy(id: Int!, title: String, description: String, department: String, status: String): AtsVacancy!
    applyAtsApplication(
      tin: String!
      vacancyId: Int!
      fullName: String!
      phone: String
      email: String
      coverNote: String
      cvSecureUrl: String
      cvPublicId: String
      cvBytes: Int
      cvFormat: String
      cvOriginalFilename: String
    ): AtsApplication!
    updateAtsApplicationStatus(id: Int!, status: String!): AtsApplication!
    hireAtsApplication(
      id: Int!
      hireDate: String
      department: String
      jobTitle: String
      wageType: String
      baseSalaryETB: Float
    ): HireAtsApplicationResult!
`;

function mapOtpRow(row, otpPreview = "") {
  return {
    ...row,
    hasCode: Boolean(String(row.otpHash || "").trim()),
    otpPreview: otpPreview || "",
  };
}

function requireTenant(context, tenantScopeFromContext) {
  const tin = String(tenantScopeFromContext(context) || "").trim();
  if (!tin) throw new Error("Tenant scope required");
  return tin;
}

export function createAtsResolvers({
  prisma,
  tenantScopeFromContext,
  assertRole,
  JWT_Secret,
}) {
  const assertManager = (context) => assertRole(context, ["Manager", "Admin"]);

  function signAtsAdmin(row) {
    if (!JWT_Secret) throw new Error("Server misconfigured");
    return jwt.sign(
      {
        kind: ATS_ADMIN_TOKEN_KIND,
        tinNumber: row.tinNumber,
        HotelName: row.HotelName || row.tinNumber,
        role: row.role,
      },
      JWT_Secret,
      { expiresIn: ATS_ADMIN_TTL },
    );
  }

  function atsAdminFromContext(context) {
    const u = context?.user;
    if (!u || u.kind !== ATS_ADMIN_TOKEN_KIND) return null;
    const tin = String(u.tinNumber || "").trim();
    const role = normalizeAtsRole(u.role);
    if (!tin || !role) return null;
    return {
      tinNumber: tin,
      HotelName: String(u.HotelName || tin).trim() || tin,
      role,
    };
  }

  function requireAtsAdmin(context) {
    const admin = atsAdminFromContext(context);
    if (!admin) throw new Error("ATS Admin session required");
    return admin;
  }

  /** F40 — offer stage / hire from ATS requires Manager role OTP session. */
  function requireAtsManager(context) {
    const admin = requireAtsAdmin(context);
    if (admin.role !== "Manager") {
      throw new Error(
        "Manager ATS access required for offer and hire (F40)",
      );
    }
    return admin;
  }

  function todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  async function displayNameForTin(tin) {
    const acct = await prisma.tenant_account.findUnique({
      where: { tinNumber: tin },
      select: { hotelDisplayName: true },
    });
    if (acct) {
      const name = String(acct.hotelDisplayName || "").trim();
      if (name) return name;
    }
    const user = await prisma.user.findFirst({
      where: { tinNumber: tin },
      select: { HotelName: true },
      orderBy: { id: "asc" },
    });
    return String(user?.HotelName || "").trim() || tin;
  }

  return {
    AtsApplication: {
      vacancy: (row) =>
        prisma.ats_vacancy.findUnique({ where: { id: row.vacancyId } }),
    },
    Query: {
      atsAccessOtps: async (_, __, context) => {
        assertManager(context);
        const tin = requireTenant(context, tenantScopeFromContext);
        const rows = await prisma.ats_access_otp.findMany({
          where: { tinNumber: tin },
          orderBy: { role: "asc" },
        });
        return rows.map((r) => mapOtpRow(r));
      },
      atsTenantPublic: async (_, { tin }) => {
        const key = String(tin || "").trim();
        if (!key) return null;
        const acct = await prisma.tenant_account.findUnique({
          where: { tinNumber: key },
          select: { tinNumber: true },
        });
        if (!acct) {
          const any = await prisma.user.findFirst({
            where: { tinNumber: key },
            select: { id: true },
          });
          if (!any) return null;
        }
        return {
          tinNumber: key,
          displayName: await displayNameForTin(key),
        };
      },
      atsOpenVacancies: async (_, { tin }) => {
        const key = String(tin || "").trim();
        if (!key) return [];
        return prisma.ats_vacancy.findMany({
          where: { tinNumber: key, status: "open" },
          orderBy: { updatedAt: "desc" },
        });
      },
      atsVacancyPublic: async (_, { tin, id }) => {
        const key = String(tin || "").trim();
        const row = await prisma.ats_vacancy.findFirst({
          where: { id: Number(id), tinNumber: key, status: "open" },
        });
        return row;
      },
      atsAdminVacancies: async (_, __, context) => {
        const admin = requireAtsAdmin(context);
        return prisma.ats_vacancy.findMany({
          where: { tinNumber: admin.tinNumber },
          orderBy: { updatedAt: "desc" },
        });
      },
      atsAdminApplications: async (_, { vacancyId, status }, context) => {
        const admin = requireAtsAdmin(context);
        const where = { tinNumber: admin.tinNumber };
        if (vacancyId != null) where.vacancyId = Number(vacancyId);
        if (status && APPLICATION_STATUSES.has(String(status))) {
          where.status = String(status);
        }
        return prisma.ats_application.findMany({
          where,
          orderBy: { createdAt: "desc" },
        });
      },
      atsAdminMe: async (_, __, context) => {
        const admin = atsAdminFromContext(context);
        if (!admin) return null;
        return {
          token: "",
          tinNumber: admin.tinNumber,
          HotelName: admin.HotelName,
          role: admin.role,
          displayName: await displayNameForTin(admin.tinNumber),
        };
      },
    },
    Mutation: {
      upsertAtsAccessOtp: async (_, { role }, context) => {
        assertManager(context);
        const tin = requireTenant(context, tenantScopeFromContext);
        const atsRole = assertAtsRole(role);
        const updatedBy = String(
          context.user?.UserName || context.user?.userName || "",
        ).trim();
        const hotel = String(
          context.user?.HotelName || tin,
        ).trim() || tin;
        const { plain, row } = await issueUniqueAtsAccessOtp(prisma, {
          tinNumber: tin,
          HotelName: hotel,
          role: atsRole,
          updatedBy,
        });
        return mapOtpRow(row, plain);
      },
      atsAdminUnlock: async (_, { otp }) => {
        const row = await findAtsAccessByOtp(prisma, otp);
        if (!row) throw new Error("Invalid ATS access code");
        const token = signAtsAdmin(row);
        return {
          token,
          tinNumber: row.tinNumber,
          HotelName: row.HotelName || row.tinNumber,
          role: row.role,
          displayName: await displayNameForTin(row.tinNumber),
        };
      },
      createAtsVacancy: async (
        _,
        { title, description, department, status },
        context,
      ) => {
        const admin = requireAtsAdmin(context);
        const st = String(status || "open").trim() || "open";
        if (!VACANCY_STATUSES.has(st)) throw new Error("Invalid vacancy status");
        const t = String(title || "").trim();
        if (!t) throw new Error("Title is required");
        return prisma.ats_vacancy.create({
          data: {
            tinNumber: admin.tinNumber,
            HotelName: admin.HotelName,
            title: t,
            description: String(description || "").trim(),
            department: String(department || "").trim(),
            status: st,
            createdByRole: admin.role,
            updatedByRole: admin.role,
          },
        });
      },
      updateAtsVacancy: async (
        _,
        { id, title, description, department, status },
        context,
      ) => {
        const admin = requireAtsAdmin(context);
        const existing = await prisma.ats_vacancy.findFirst({
          where: { id: Number(id), tinNumber: admin.tinNumber },
        });
        if (!existing) throw new Error("Vacancy not found");
        const data = { updatedByRole: admin.role };
        if (title != null) {
          const t = String(title).trim();
          if (!t) throw new Error("Title is required");
          data.title = t;
        }
        if (description != null) data.description = String(description).trim();
        if (department != null) data.department = String(department).trim();
        if (status != null) {
          const st = String(status).trim();
          if (!VACANCY_STATUSES.has(st)) throw new Error("Invalid vacancy status");
          data.status = st;
        }
        return prisma.ats_vacancy.update({
          where: { id: existing.id },
          data,
        });
      },
      applyAtsApplication: async (
        _,
        {
          tin,
          vacancyId,
          fullName,
          phone,
          email,
          coverNote,
          cvSecureUrl,
          cvPublicId,
          cvBytes,
          cvFormat,
          cvOriginalFilename,
        },
      ) => {
        const key = String(tin || "").trim();
        const name = String(fullName || "").trim();
        if (!key || !name) throw new Error("Name and tenant are required");
        const vacancy = await prisma.ats_vacancy.findFirst({
          where: {
            id: Number(vacancyId),
            tinNumber: key,
            status: "open",
          },
        });
        if (!vacancy) throw new Error("Vacancy is not open for applications");
        return prisma.ats_application.create({
          data: {
            vacancyId: vacancy.id,
            tinNumber: key,
            HotelName: vacancy.HotelName,
            fullName: name,
            phone: String(phone || "").trim(),
            email: String(email || "").trim(),
            coverNote: String(coverNote || "").trim(),
            cvSecureUrl: String(cvSecureUrl || "").trim(),
            cvPublicId: String(cvPublicId || "").trim(),
            cvBytes: Number(cvBytes) || 0,
            cvFormat: String(cvFormat || "").trim(),
            cvOriginalFilename: String(cvOriginalFilename || "").trim(),
            status: "applied",
            updatedByRole: "",
          },
        });
      },
      updateAtsApplicationStatus: async (_, { id, status }, context) => {
        const admin = requireAtsAdmin(context);
        const st = String(status || "").trim();
        if (!APPLICATION_STATUSES.has(st)) {
          throw new Error("Invalid application status");
        }
        // F40: offer / offer_accepted need Manager role session
        if (st === "offer" || st === "offer_accepted") {
          requireAtsManager(context);
        }
        const existing = await prisma.ats_application.findFirst({
          where: { id: Number(id), tinNumber: admin.tinNumber },
        });
        if (!existing) throw new Error("Application not found");
        return prisma.ats_application.update({
          where: { id: existing.id },
          data: { status: st, updatedByRole: admin.role },
        });
      },

      hireAtsApplication: async (
        _,
        { id, hireDate, department, jobTitle, wageType, baseSalaryETB },
        context,
      ) => {
        const admin = requireAtsManager(context);
        const existing = await prisma.ats_application.findFirst({
          where: { id: Number(id), tinNumber: admin.tinNumber },
          include: { vacancy: true },
        });
        if (!existing) throw new Error("Application not found");
        if (existing.employeeId) {
          throw new Error("Candidate already hired into HR");
        }
        const st = String(existing.status || "").trim();
        if (st !== "offer" && st !== "offer_accepted") {
          throw new Error(
            "Set status to offer (Manager) before hiring",
          );
        }

        const HotelName = admin.tinNumber;
        const vac = existing.vacancy;
        const dept =
          String(department || "").trim() ||
          String(vac?.department || "").trim();
        const title =
          String(jobTitle || "").trim() ||
          String(vac?.title || "").trim();
        let wt = String(wageType || "monthly").trim() || "monthly";
        if (wt !== "monthly" && wt !== "weekly") wt = "monthly";
        const hdRaw = String(hireDate || "").trim();
        const hd = /^\d{4}-\d{2}-\d{2}$/.test(hdRaw) ? hdRaw : todayYmd();
        const noteBits = [
          `Hired from ATS application #${existing.id}`,
          existing.coverNote ? `Cover: ${existing.coverNote}` : "",
          existing.cvSecureUrl ? `CV: ${existing.cvSecureUrl}` : "",
        ].filter(Boolean);

        const employee = await prisma.hr_employee.create({
          data: {
            HotelName,
            fullName: String(existing.fullName || "").trim(),
            phone: String(existing.phone || "").trim(),
            email: String(existing.email || "").trim(),
            department: dept,
            jobTitle: title,
            orgPosition: "employee",
            teamId: null,
            status: "active",
            hireDate: hd,
            wageType: wt,
            baseSalaryETB: round2(baseSalaryETB),
            bankName: "",
            accountNumber: "",
            credentialUserId: null,
            credentialUserName: "",
            notes: noteBits.join("\n"),
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

        const portalOtpPreview = await issueUniquePortalOtp(
          prisma,
          employee.id,
          "Manager",
        );

        const application = await prisma.ats_application.update({
          where: { id: existing.id },
          data: {
            status: "offer_accepted",
            employeeId: employee.id,
            updatedByRole: admin.role,
          },
        });

        return {
          application,
          portalOtpPreview,
          employeeId: employee.id,
        };
      },
    },
  };
}

/** Merge ATS admin JWT into Apollo context.user when Bearer is an ATS token. */
export function tryDecodeAtsAdminToken(token, JWT_Secret) {
  if (!token || !JWT_Secret) return null;
  try {
    const payload = jwt.verify(token, JWT_Secret);
    if (payload?.kind !== ATS_ADMIN_TOKEN_KIND) return null;
    return payload;
  } catch {
    return null;
  }
}
