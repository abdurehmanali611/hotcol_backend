/**
 * Smoke tests for hrPortalOtp.js — run: node scripts/test-hr-portal-otp.mjs
 */
import assert from "assert";
import {
  normalizePortalOtp,
  isValidPortalOtpFormat,
  generatePortalOtp,
  hashPortalOtp,
  verifyPortalOtp,
  clearOtpPreviewFields,
  issuePortalOtpPayload,
} from "../hrPortalOtp.js";

assert.strictEqual(normalizePortalOtp(" ab12cd "), "AB12CD");
assert.strictEqual(isValidPortalOtpFormat("AB1234"), true);
assert.strictEqual(isValidPortalOtpFormat("123456"), true);
assert.strictEqual(isValidPortalOtpFormat("ABCDEF"), true);
assert.strictEqual(isValidPortalOtpFormat("AB12"), false);
assert.strictEqual(isValidPortalOtpFormat("AB12$4"), false);

for (let i = 0; i < 20; i++) {
  const otp = generatePortalOtp();
  assert.ok(isValidPortalOtpFormat(otp), `generated invalid: ${otp}`);
  assert.ok(/[A-Z]/.test(otp) && /[0-9]/.test(otp), `expected mix: ${otp}`);
}

const plain = "AB1234";
const hash = await hashPortalOtp(plain);
assert.ok(await verifyPortalOtp("ab1234", hash));
assert.ok(!(await verifyPortalOtp("ZZ9999", hash)));

const cleared = clearOtpPreviewFields();
assert.strictEqual(cleared.portalOtpPreview, "");
assert.strictEqual(cleared.portalOtpViewer, "none");

const issued = issuePortalOtpPayload("xy9k2m", "HR");
assert.strictEqual(issued.plain, "XY9K2M");
assert.strictEqual(issued.portalOtpViewer, "HR");
assert.strictEqual(issued.mustChangeOtp, true);

console.log("hrPortalOtp tests: PASS");
