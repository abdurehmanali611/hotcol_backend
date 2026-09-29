/**
 * ATS GraphQL — Manager OTP create/rotate/delete + preview until first unlock.
 * Candidate + Admin APIs live in hotcol-ats/BackEnd.
 */
import {
  assertAtsRole,
  deleteAtsAccessOtp,
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
    """True until the role unlocks ATS Admin for the first time after issue/reset."""
    awaitingFirstUnlock: Boolean!
    mustChangeOtp: Boolean!
    updatedBy: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    otpIssuedAt: DateTime
    firstUnlockAt: DateTime
    """Plaintext while awaiting first unlock — empty after Admin unlocks."""
    otpPreview: String!
  }
`;

export const atsQueryFields = `
    atsAccessOtps: [AtsAccessOtp!]!
`;

export const atsMutationFields = `
    upsertAtsAccessOtp(role: String!): AtsAccessOtp!
    deleteAtsAccessOtp(role: String!): Boolean!
`;

function mapOtpRow(row, otpPreviewOverride = null) {
  const hasCode = Boolean(String(row.otpHash || "").trim());
  const awaitingFirstUnlock = hasCode && !row.firstUnlockAt;
  const previewFromDb = awaitingFirstUnlock
    ? String(row.otpPreview || "").trim()
    : "";
  return {
    ...row,
    hasCode,
    awaitingFirstUnlock,
    mustChangeOtp: Boolean(row.mustChangeOtp),
    otpPreview:
      otpPreviewOverride != null ? otpPreviewOverride : previewFromDb,
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
      deleteAtsAccessOtp: async (_, { role }, context) => {
        assertManager(context);
        const tin = requireTenant(context, tenantScopeFromContext);
        return deleteAtsAccessOtp(prisma, { tinNumber: tin, role });
      },
    },
  };
}
