/**
 * ATS GraphQL — public Candidate + Admin unlock / vacancies / pipeline / hire.
 * Manager ATS OTP create/rotate lives in hotcol-user only.
 */
import jwt from "jsonwebtoken";
import {
  clearAtsOtpPreviewFields,
  deleteAtsAccessOtp as deleteAtsAccessOtpRow,
  findAtsAccessByOtp,
  hashPortalOtp,
  isAtsOtpTaken,
  isValidPortalOtpFormat,
  issueUniqueAtsAccessOtp,
  normalizeAtsRole,
  normalizePortalOtp,
  verifyPortalOtp,
} from "./atsPortalOtp.js";
import { issueUniquePortalOtp } from "./hrPortalOtp.js";
import { ATS_ADMIN_TOKEN_KIND, JWT_Secret } from "./lib/auth.js";

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

const ATS_ADMIN_TTL = "12h";

export const atsTypeDefs = `
  type AtsTenantPublic {
    tinNumber: String!
    displayName: String!
    logoUrl: String
  }

  type AtsVacancy {
    id: Int!
    tinNumber: String!
    HotelName: String!
    title: String!
    description: String!
    department: String!
    team: String!
    grossSalaryETB: Float
    addressSpec: String!
    requireEmail: Boolean!
    requireCv: Boolean!
    status: String!
    createdByRole: String!
    updatedByRole: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type AtsHrDepartment {
    id: Int!
    code: String!
    label: String!
    teams: [AtsHrTeam!]!
  }

  type AtsHrTeam {
    id: Int!
    code: String!
    label: String!
    departmentId: Int!
  }

  type AtsAdminHrOrg {
    departments: [AtsHrDepartment!]!
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
    yearsExperience: String!
    educationLevel: String!
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
    logoUrl: String
    mustChangeOtp: Boolean!
  }

  """Offer → hire handoff (F40): creates HR employee + portal OTP."""
  type HireAtsApplicationResult {
    application: AtsApplication!
    """Plaintext hire OTP — shown once; not stored for ATS re-read."""
    portalOtpPreview: String!
    employeeId: Int!
  }

  """Manager-facing ATS Admin unlock codes (HR / Manager roles)."""
  type AtsAccessOtp {
    id: Int!
    tinNumber: String!
    HotelName: String!
    role: String!
    hasCode: Boolean!
    awaitingFirstUnlock: Boolean!
    mustChangeOtp: Boolean!
    updatedBy: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    otpIssuedAt: DateTime
    firstUnlockAt: DateTime
    """Plaintext only while awaiting first Admin unlock; else empty."""
    otpPreview: String!
  }
`;

export const atsTypeDefsBlock = atsTypeDefs;

export const atsQueryFields = `
    atsTenantPublic(tin: String!): AtsTenantPublic
    atsOpenVacancies(tin: String!): [AtsVacancy!]!
    atsVacancyPublic(tin: String!, id: Int!): AtsVacancy
    atsAdminVacancies: [AtsVacancy!]!
    atsAdminHrOrg: AtsAdminHrOrg!
    atsAdminApplications(vacancyId: Int, status: String): [AtsApplication!]!
    atsAdminMe: AtsAdminSession
    """Manager: list ATS Admin unlock codes for this property."""
    atsAccessOtps: [AtsAccessOtp!]!
`;

export const atsMutationFields = `
    """Manager: create or reset ATS Admin unlock code for HR or Manager role."""
    upsertAtsAccessOtp(role: String!): AtsAccessOtp!
    """Manager: delete ATS Admin unlock code for a role."""
    deleteAtsAccessOtp(role: String!): Boolean!
    atsAdminUnlock(otp: String!): AtsAdminSession!
    changeAtsAdminOtp(currentOtp: String!, newOtp: String!): Boolean!
    createAtsVacancy(
      title: String!
      description: String
      department: String
      team: String
      grossSalaryETB: Float
      addressSpec: String
      requireEmail: Boolean
      requireCv: Boolean
      status: String
    ): AtsVacancy!
    updateAtsVacancy(
      id: Int!
      title: String
      description: String
      department: String
      team: String
      grossSalaryETB: Float
      addressSpec: String
      requireEmail: Boolean
      requireCv: Boolean
      status: String
    ): AtsVacancy!
    applyAtsApplication(
      tin: String!
      vacancyId: Int!
      fullName: String!
      phone: String
      email: String
      coverNote: String
      yearsExperience: String
      educationLevel: String
      cvSecureUrl: String
      cvPublicId: String
      cvBytes: Int
      cvFormat: String
      cvOriginalFilename: String
    ): AtsApplication!
    updateAtsApplicationStatus(id: Int!, status: String!): AtsApplication!
    """Bulk status move for Pass / MultiPass / Reject / Withdrawn."""
    updateAtsApplicationStatuses(ids: [Int!]!, status: String!): Int!
    hireAtsApplication(
      id: Int!
      hireDate: String
      department: String
      jobTitle: String
      wageType: String
      baseSalaryETB: Float
    ): HireAtsApplicationResult!
`;

function mapAtsAccessOtp(row) {
  if (!row) return null;
  const hasCode = Boolean(String(row.otpHash || "").trim());
  const awaitingFirstUnlock = hasCode && !row.firstUnlockAt;
  return {
    id: row.id,
    tinNumber: row.tinNumber,
    HotelName: row.HotelName || "",
    role: row.role,
    hasCode,
    awaitingFirstUnlock,
    mustChangeOtp: Boolean(row.mustChangeOtp),
    updatedBy: row.updatedBy || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    otpIssuedAt: row.otpIssuedAt ?? null,
    firstUnlockAt: row.firstUnlockAt ?? null,
    otpPreview: awaitingFirstUnlock
      ? String(row.otpPreview || "").trim()
      : "",
  };
}

export function createAtsResolvers({
  prisma,
  tenantScopeFromContext,
  assertRole,
}) {
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

  function requireManagerForAtsOtp(context) {
    if (typeof assertRole !== "function") {
      throw new Error("Server misconfigured");
    }
    assertRole(context, ["Manager", "Admin"]);
    const tin =
      typeof tenantScopeFromContext === "function"
        ? tenantScopeFromContext(context)
        : null;
    if (!tin) throw new Error("Tenant scope missing");
    const hotel =
      String(context?.user?.HotelName || "").trim() || String(tin).trim();
    const updatedBy =
      String(
        context?.user?.UserName ||
          context?.user?.displayName ||
          context?.user?.name ||
          "",
      ).trim() || "Manager";
    return { tinNumber: String(tin).trim(), HotelName: hotel, updatedBy };
  }

  function atsAdminFromContext(context) {
    const u = context?.user;
    if (!u || u.__authExpired) return null;
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
    if (context?.user?.__authExpired) throw new Error("Session expired");
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

  async function brandForTin(tin) {
    const key = String(tin || "").trim();
    const acct = await prisma.tenant_account.findUnique({
      where: { tinNumber: key },
      select: { hotelDisplayName: true, logoUrl: true },
    });
    let displayName = String(acct?.hotelDisplayName || "").trim();
    if (!displayName) {
      displayName = await displayNameForTin(key);
    }
    const logoUrl = String(acct?.logoUrl || "").trim() || null;
    return { displayName, logoUrl };
  }

  /** HR org rows are scoped by HotelName (= TIN in Manager session). */
  function hrHotelKeys(admin) {
    const keys = new Set();
    const a = String(admin.HotelName || "").trim();
    const t = String(admin.tinNumber || "").trim();
    if (a) keys.add(a);
    if (t) keys.add(t);
    return [...keys];
  }

  function parseOptionalSalary(raw) {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("Gross salary must be a non-negative number");
    }
    return round2(n);
  }

  /** Coerce nulls from pre-migration rows so GraphQL Boolean! / String! stay valid. */
  function normalizeVacancy(row) {
    if (!row) return row;
    return {
      ...row,
      team: row.team ?? "",
      addressSpec: row.addressSpec ?? "",
      requireEmail: Boolean(row.requireEmail),
      requireCv: row.requireCv == null ? true : Boolean(row.requireCv),
    };
  }

  return {
    AtsVacancy: {
      team: (row) => row.team ?? "",
      addressSpec: (row) => row.addressSpec ?? "",
      requireEmail: (row) => Boolean(row.requireEmail),
      requireCv: (row) =>
        row.requireCv == null ? true : Boolean(row.requireCv),
    },
    AtsApplication: {
      vacancy: async (row) =>
        normalizeVacancy(
          await prisma.ats_vacancy.findUnique({ where: { id: row.vacancyId } }),
        ),
    },
    Query: {
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
          ...(await brandForTin(key)),
        };
      },
      atsOpenVacancies: async (_, { tin }) => {
        const key = String(tin || "").trim();
        if (!key) return [];
        const rows = await prisma.ats_vacancy.findMany({
          where: { tinNumber: key, status: "open" },
          orderBy: { updatedAt: "desc" },
        });
        return rows.map(normalizeVacancy);
      },
      atsVacancyPublic: async (_, { tin, id }) => {
        const key = String(tin || "").trim();
        return normalizeVacancy(
          await prisma.ats_vacancy.findFirst({
            where: { id: Number(id), tinNumber: key, status: "open" },
          }),
        );
      },
      atsAdminVacancies: async (_, __, context) => {
        const admin = requireAtsAdmin(context);
        const rows = await prisma.ats_vacancy.findMany({
          where: { tinNumber: admin.tinNumber },
          orderBy: { updatedAt: "desc" },
        });
        return rows.map(normalizeVacancy);
      },
      atsAdminHrOrg: async (_, __, context) => {
        const admin = requireAtsAdmin(context);
        const hotels = hrHotelKeys(admin);
        if (hotels.length === 0) return { departments: [] };
        const departments = await prisma.hr_department.findMany({
          where: { HotelName: { in: hotels }, active: true },
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
          include: {
            teams: {
              where: { active: true },
              orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
            },
          },
        });
        return {
          departments: departments.map((d) => ({
            id: d.id,
            code: d.code,
            label: d.label,
            teams: (d.teams || []).map((t) => ({
              id: t.id,
              code: t.code,
              label: t.label,
              departmentId: t.departmentId,
            })),
          })),
        };
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
        const row = await prisma.ats_access_otp.findUnique({
          where: {
            tinNumber_role: {
              tinNumber: admin.tinNumber,
              role: admin.role,
            },
          },
          select: { mustChangeOtp: true, otpHash: true },
        });
        return {
          token: "",
          tinNumber: admin.tinNumber,
          HotelName: admin.HotelName,
          role: admin.role,
          ...(await brandForTin(admin.tinNumber)),
          mustChangeOtp: Boolean(row?.mustChangeOtp),
        };
      },
      atsAccessOtps: async (_, __, context) => {
        const { tinNumber } = requireManagerForAtsOtp(context);
        const rows = await prisma.ats_access_otp.findMany({
          where: { tinNumber },
          orderBy: { role: "asc" },
        });
        return rows.map(mapAtsAccessOtp).filter(Boolean);
      },
    },
    Mutation: {
      upsertAtsAccessOtp: async (_, { role }, context) => {
        const scope = requireManagerForAtsOtp(context);
        const { plain, row } = await issueUniqueAtsAccessOtp(prisma, {
          tinNumber: scope.tinNumber,
          HotelName: scope.HotelName,
          role,
          updatedBy: scope.updatedBy,
        });
        return mapAtsAccessOtp({
          ...row,
          otpPreview: plain,
          firstUnlockAt: null,
        });
      },
      deleteAtsAccessOtp: async (_, { role }, context) => {
        const scope = requireManagerForAtsOtp(context);
        await deleteAtsAccessOtpRow(prisma, {
          tinNumber: scope.tinNumber,
          role,
        });
        return true;
      },
      atsAdminUnlock: async (_, { otp }) => {
        const row = await findAtsAccessByOtp(prisma, otp);
        if (!row) throw new Error("Invalid ATS access code");

        const isFirstUnlock = !row.firstUnlockAt;
        let mustChange = Boolean(row.mustChangeOtp);
        if (isFirstUnlock) {
          const updated = await prisma.ats_access_otp.update({
            where: { id: row.id },
            data: {
              firstUnlockAt: new Date(),
              ...clearAtsOtpPreviewFields(),
            },
          });
          mustChange = Boolean(updated.mustChangeOtp);
        }

        const token = signAtsAdmin(row);
        return {
          token,
          tinNumber: row.tinNumber,
          HotelName: row.HotelName || row.tinNumber,
          role: row.role,
          ...(await brandForTin(row.tinNumber)),
          mustChangeOtp: mustChange,
        };
      },

      changeAtsAdminOtp: async (_, { currentOtp, newOtp }, context) => {
        const admin = requireAtsAdmin(context);
        const row = await prisma.ats_access_otp.findUnique({
          where: {
            tinNumber_role: {
              tinNumber: admin.tinNumber,
              role: admin.role,
            },
          },
        });
        if (!row || !String(row.otpHash || "").trim()) {
          throw new Error("ATS access code not found");
        }
        const cur = normalizePortalOtp(currentOtp);
        const next = normalizePortalOtp(newOtp);
        if (!isValidPortalOtpFormat(next)) {
          throw new Error("New code must be 6 alphanumeric characters");
        }
        if (!(await verifyPortalOtp(cur, row.otpHash))) {
          throw new Error("Current access code is incorrect");
        }
        if (cur === next) {
          throw new Error("Choose a different access code");
        }
        if (
          await isAtsOtpTaken(prisma, next, { excludeId: row.id })
        ) {
          throw new Error("That code is already in use — choose another");
        }
        const otpHash = await hashPortalOtp(next);
        await prisma.ats_access_otp.update({
          where: { id: row.id },
          data: {
            otpHash,
            otpLookup: next,
            mustChangeOtp: false,
            ...clearAtsOtpPreviewFields(),
          },
        });
        return true;
      },

      createAtsVacancy: async (
        _,
        {
          title,
          description,
          department,
          team,
          grossSalaryETB,
          addressSpec,
          requireEmail,
          requireCv,
          status,
        },
        context,
      ) => {
        const admin = requireAtsAdmin(context);
        const st = String(status || "open").trim() || "open";
        if (!VACANCY_STATUSES.has(st)) throw new Error("Invalid vacancy status");
        const t = String(title || "").trim();
        if (!t) throw new Error("Title is required");
        const dept = String(department || "").trim();
        if (!dept) throw new Error("Department is required");
        return normalizeVacancy(
          await prisma.ats_vacancy.create({
            data: {
              tinNumber: admin.tinNumber,
              HotelName: admin.HotelName,
              title: t,
              description: String(description || "").trim(),
              department: dept,
              team: String(team || "").trim(),
              grossSalaryETB: parseOptionalSalary(grossSalaryETB),
              addressSpec: String(addressSpec || "").trim(),
              requireEmail: Boolean(requireEmail),
              requireCv: requireCv === undefined ? true : Boolean(requireCv),
              status: st,
              createdByRole: admin.role,
              updatedByRole: admin.role,
            },
          }),
        );
      },
      updateAtsVacancy: async (
        _,
        {
          id,
          title,
          description,
          department,
          team,
          grossSalaryETB,
          addressSpec,
          requireEmail,
          requireCv,
          status,
        },
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
        if (department != null) {
          const dept = String(department).trim();
          if (!dept) throw new Error("Department is required");
          data.department = dept;
        }
        if (team != null) data.team = String(team).trim();
        if (grossSalaryETB !== undefined) {
          data.grossSalaryETB = parseOptionalSalary(grossSalaryETB);
        }
        if (addressSpec != null) {
          data.addressSpec = String(addressSpec).trim();
        }
        if (requireEmail !== undefined) data.requireEmail = Boolean(requireEmail);
        if (requireCv !== undefined) data.requireCv = Boolean(requireCv);
        if (status != null) {
          const st = String(status).trim();
          if (!VACANCY_STATUSES.has(st)) throw new Error("Invalid vacancy status");
          data.status = st;
        }
        return normalizeVacancy(
          await prisma.ats_vacancy.update({
            where: { id: existing.id },
            data,
          }),
        );
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
          yearsExperience,
          educationLevel,
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

        const emailTrim = String(email || "").trim();
        const cvUrl = String(cvSecureUrl || "").trim();
        const years = String(yearsExperience || "").trim();
        const education = String(educationLevel || "").trim();

        if (!years) throw new Error("Years of experience is required");
        if (!education) throw new Error("Education level is required");
        const needEmail = Boolean(vacancy.requireEmail);
        const needCv =
          vacancy.requireCv == null ? true : Boolean(vacancy.requireCv);
        if (needEmail && !emailTrim) {
          throw new Error("Email is required for this role");
        }
        if (needCv && !cvUrl) {
          throw new Error("CV upload is required for this role");
        }

        return prisma.ats_application.create({
          data: {
            vacancyId: vacancy.id,
            tinNumber: key,
            HotelName: vacancy.HotelName,
            fullName: name,
            phone: String(phone || "").trim(),
            email: emailTrim,
            coverNote: String(coverNote || "").trim(),
            yearsExperience: years,
            educationLevel: education,
            cvSecureUrl: cvUrl,
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
        if (st === "offer" || st === "offer_accepted") {
          try {
            requireAtsManager(context);
          } catch {
            throw new Error(
              "Unlock Admin with the Manager ATS OTP to move candidates to Offer or Offer accepted (F40)",
            );
          }
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
      updateAtsApplicationStatuses: async (_, { ids, status }, context) => {
        const admin = requireAtsAdmin(context);
        const st = String(status || "").trim();
        if (!APPLICATION_STATUSES.has(st)) {
          throw new Error("Invalid application status");
        }
        if (st === "offer" || st === "offer_accepted") {
          try {
            requireAtsManager(context);
          } catch {
            throw new Error(
              "Unlock Admin with the Manager ATS OTP to move candidates to Offer or Offer accepted (F40)",
            );
          }
        }
        const idList = [
          ...new Set(
            (Array.isArray(ids) ? ids : [])
              .map((n) => Number(n))
              .filter((n) => Number.isFinite(n) && n > 0),
          ),
        ];
        if (idList.length === 0) return 0;
        const result = await prisma.ats_application.updateMany({
          where: {
            tinNumber: admin.tinNumber,
            id: { in: idList },
          },
          data: { status: st, updatedByRole: admin.role },
        });
        return result.count;
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
          throw new Error("Set status to offer (Manager) before hiring");
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
