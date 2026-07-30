/** Guest room-portal OTP helpers (issued at check-in in lodgingGraphql). */

export const OTP_LENGTH = 6;

export function generateGuestOtp() {
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(OTP_LENGTH, "0");
}

/**
 * Issue a globally unique OTP for an active stay.
 * Retries on collision so concurrent check-ins never share a code.
 */
export async function issueUniqueGuestOtp(
  prisma,
  stayId,
  { maxAttempts = 24 } = {},
) {
  const id = Number(stayId);
  if (!(id > 0)) throw new Error("Invalid stay id");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const otp = generateGuestOtp();
    const clash = await prisma.lodging_stay.findFirst({
      where: { guestOtp: otp },
      select: { id: true },
    });
    if (clash) continue;

    try {
      await prisma.lodging_stay.update({
        where: { id },
        data: {
          guestOtp: otp,
          guestOtpIssuedAt: new Date(),
        },
      });
      return otp;
    } catch (err) {
      if (String(err?.code) === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique room code — try again");
}

/** Clear OTP so the code can be reused after checkout. */
export async function clearGuestOtp(prisma, stayId) {
  const id = Number(stayId);
  if (!(id > 0)) return;
  await prisma.lodging_stay.update({
    where: { id },
    data: {
      guestOtp: null,
      guestOtpIssuedAt: null,
    },
  });
}
