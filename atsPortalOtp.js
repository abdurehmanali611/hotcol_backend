/**
 * ATS Admin role OTP helpers (hotcol-ats Admin unlock).
 * Same charset/format as employee portal OTP; uniqueness via ats_access_otp.otpLookup
 * (and must not collide with active employee portalOtpLookup).
 */
import {
  generatePortalOtp,
  hashPortalOtp,
  isValidPortalOtpFormat,
  isPortalOtpTaken,
  normalizePortalOtp,
  verifyPortalOtp,
} from "./hrPortalOtp.js";

const ATS_ROLES = new Set(["HR", "Manager"]);

export function normalizeAtsRole(raw) {
  const r = String(raw ?? "").trim();
  if (r === "HR" || r === "Manager") return r;
  return "";
}

export function assertAtsRole(role) {
  const r = normalizeAtsRole(role);
  if (!ATS_ROLES.has(r)) throw new Error("ATS role must be HR or Manager");
  return r;
}

export async function isAtsOtpTaken(prisma, otp, { excludeId = null } = {}) {
  const code = normalizePortalOtp(otp);
  if (!isValidPortalOtpFormat(code)) return false;
  if (await isPortalOtpTaken(prisma, code)) return true;
  const where = { otpLookup: code };
  if (excludeId != null && Number(excludeId) > 0) {
    where.id = { not: Number(excludeId) };
  }
  const clash = await prisma.ats_access_otp.findFirst({
    where,
    select: { id: true },
  });
  return Boolean(clash);
}

/**
 * Issue or rotate ATS OTP for (tinNumber, role). Returns plaintext once.
 */
export async function issueUniqueAtsAccessOtp(
  prisma,
  { tinNumber, HotelName, role, updatedBy },
  { maxAttempts = 40 } = {},
) {
  const tin = String(tinNumber ?? "").trim();
  if (!tin) throw new Error("TIN is required");
  const atsRole = assertAtsRole(role);
  const hotel = String(HotelName ?? tin).trim() || tin;

  const existing = await prisma.ats_access_otp.findUnique({
    where: { tinNumber_role: { tinNumber: tin, role: atsRole } },
    select: { id: true },
  });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const plain = generatePortalOtp();
    const taken = await isAtsOtpTaken(prisma, plain, {
      excludeId: existing?.id ?? null,
    });
    if (taken) continue;

    const hash = await hashPortalOtp(plain);
    const row = await prisma.ats_access_otp.upsert({
      where: { tinNumber_role: { tinNumber: tin, role: atsRole } },
      create: {
        tinNumber: tin,
        HotelName: hotel,
        role: atsRole,
        otpHash: hash,
        otpLookup: plain,
        updatedBy: String(updatedBy ?? "").trim(),
      },
      update: {
        HotelName: hotel,
        otpHash: hash,
        otpLookup: plain,
        updatedBy: String(updatedBy ?? "").trim(),
      },
    });
    return { plain, row };
  }
  throw new Error("Could not allocate a unique ATS access code — try again");
}

export async function findAtsAccessByOtp(prisma, otp) {
  const code = normalizePortalOtp(otp);
  if (!isValidPortalOtpFormat(code)) return null;
  const row = await prisma.ats_access_otp.findFirst({
    where: { otpLookup: code },
  });
  if (!row) return null;
  const ok = await verifyPortalOtp(code, row.otpHash);
  if (!ok) return null;
  return row;
}

export { normalizePortalOtp, verifyPortalOtp, isValidPortalOtpFormat };
