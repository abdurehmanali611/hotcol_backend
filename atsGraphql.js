/**
 * ATS GraphQL — Manager OTP create/rotate only (hotcol-user).
 * Candidate + Admin APIs live in hotcol-ats/BackEnd.
 */
import {
  assertAtsRole,
  issueUniqueAtsAccessOtp,
} from "./atsPortalOtp.js";

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
`;

export const atsQueryFields = `
    atsAccessOtps: [AtsAccessOtp!]!
`;

export const atsMutationFields = `
    upsertAtsAccessOtp(role: String!): AtsAccessOtp!
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
}) {
  const assertManager = (context) => assertRole(context, ["Manager", "Admin"]);

  return {
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
    },
    Mutation: {
      upsertAtsAccessOtp: async (_, { role }, context) => {
        assertManager(context);
        const tin = requireTenant(context, tenantScopeFromContext);
        const atsRole = assertAtsRole(role);
        const updatedBy = String(
          context.user?.UserName || context.user?.userName || "",
        ).trim();
        const hotel =
          String(context.user?.HotelName || tin).trim() || tin;
        const { plain, row } = await issueUniqueAtsAccessOtp(prisma, {
          tinNumber: tin,
          HotelName: hotel,
          role: atsRole,
          updatedBy,
        });
        return mapOtpRow(row, plain);
      },
    },
  };
}
