/**
 * Alphanumeric portal OTP/PIN helpers for hotcol-emp (bcrypt, cost 12).
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";

const OTP_LEN = 6;
const OTP_RE = /^[A-Z0-9]{6}$/;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
const DIGITS = "23456789"; // no 0/1
const MIX = LETTERS + DIGITS;

export function normalizePortalOtp(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function isValidPortalOtpFormat(otp) {
  return OTP_RE.test(normalizePortalOtp(otp));
}

/** Prefer mixed letters+digits (e.g. AB1234). */
export function generatePortalOtp() {
  const bytes = crypto.randomBytes(OTP_LEN);
  const chars = [];
  // Force at least 2 letters and 2 digits
  chars.push(LETTERS[bytes[0] % LETTERS.length]);
  chars.push(LETTERS[bytes[1] % LETTERS.length]);
  chars.push(DIGITS[bytes[2] % DIGITS.length]);
  chars.push(DIGITS[bytes[3] % DIGITS.length]);
  for (let i = 4; i < OTP_LEN; i++) {
    chars.push(MIX[bytes[i] % MIX.length]);
  }
  // Shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[i % bytes.length] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export async function hashPortalOtp(otp) {
  const normalized = normalizePortalOtp(otp);
  if (!isValidPortalOtpFormat(normalized)) {
    throw new Error("Invalid portal OTP format");
  }
  return bcrypt.hash(normalized, 12);
}

export async function verifyPortalOtp(otp, hash) {
  const normalized = normalizePortalOtp(otp);
  if (!hash || !isValidPortalOtpFormat(normalized)) return false;
  return bcrypt.compare(normalized, String(hash));
}

/** Clears plaintext preview after first login / PIN change. */
export function clearOtpPreviewFields() {
  return {
    portalOtpPreview: "",
    portalOtpViewer: "none",
  };
}

export function issuePortalOtpPayload(plainOtp, viewer) {
  const normalized = normalizePortalOtp(plainOtp);
  if (!isValidPortalOtpFormat(normalized)) {
    throw new Error("Invalid portal OTP format");
  }
  if (viewer !== "HR" && viewer !== "Manager") {
    throw new Error("portalOtpViewer must be HR or Manager when issuing");
  }
  return {
    plain: normalized,
    portalOtpPreview: normalized,
    portalOtpViewer: viewer,
    mustChangeOtp: true,
    portalOtpIssuedAt: new Date(),
  };
}
