/** Shared auth constants for HotCol user GraphQL (ATS admin tokens, JWT). */

export const JWT_Secret = process.env.JWT_Secret;

/** JWT `kind` claim for ATS Admin unlock sessions (not tenant staff logins). */
export const ATS_ADMIN_TOKEN_KIND = "ats_admin";
