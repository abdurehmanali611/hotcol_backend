/**
 * One-off: reset Apex Hotel HR payroll runs for retesting.
 */
require("dotenv").config();
const path = require("path");
const mysql = require(
  require.resolve("mysql2/promise", {
    paths: [path.join(__dirname, "..", "node_modules", "prisma")],
  }),
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  const conn = await mysql.createConnection(url);
  try {
    // HotelName in HR tables is the tenant TIN, not the display name.
    const [tenantRows] = await conn.query(
      `SELECT tinNumber, hotelDisplayName FROM tenant_account
       WHERE hotelDisplayName = ? COLLATE utf8mb4_general_ci
       LIMIT 1`,
      ["Apex Hotel"],
    );
    if (!tenantRows.length) {
      console.error("No tenant_account row for Apex Hotel");
      process.exit(1);
    }
    const hotelName = tenantRows[0].tinNumber;
    console.log(
      "Resetting payroll for:",
      tenantRows[0].hotelDisplayName,
      `(HotelName/TIN ${hotelName})`,
    );

    const [periods] = await conn.query(
      "SELECT id, fromYmd, toYmd, status FROM hr_payroll_period WHERE HotelName = ?",
      [hotelName],
    );

    const [slipRes] = await conn.query(
      "DELETE FROM hr_payslip WHERE HotelName = ?",
      [hotelName],
    );
    const [periodRes] = await conn.query(
      "DELETE FROM hr_payroll_period WHERE HotelName = ?",
      [hotelName],
    );
    const [pendingRes] = await conn.query(
      "DELETE FROM hr_manager_pending_action WHERE HotelName = ? AND kind = 'payroll_generate'",
      [hotelName],
    );
    const [notifRes] = await conn.query(
      `DELETE FROM hr_notification WHERE HotelName = ? AND kind IN (
        'manager_pending_payroll', 'payroll_generate', 'payroll_payment'
      )`,
      [hotelName],
    );
    const [bonusRes] = await conn.query(
      "UPDATE hr_bonus SET status = 'approved' WHERE HotelName = ? AND status = 'paid'",
      [hotelName],
    );
    const [advRes] = await conn.query(
      "UPDATE hr_advance_request SET status = 'approved' WHERE HotelName = ? AND status = 'paid'",
      [hotelName],
    );
    const [otRes] = await conn.query(
      `UPDATE hr_overtime_request
       SET status = 'approved'
       WHERE HotelName = ? AND status = 'paid'`,
      [hotelName],
    );
    // Restore loans so the next payroll can deduct installments again.
    const [loanRes] = await conn.query(
      `UPDATE hr_loan
       SET status = 'active',
           remainingETB = principalETB,
           installmentETB = CASE
             WHEN installmentETB IS NULL OR installmentETB <= 0 THEN principalETB
             ELSE installmentETB
           END
       WHERE HotelName = ? AND status IN ('active', 'closed', 'pending')`,
      [hotelName],
    );
    // Promote pending OT that managers already meant to use — only restore paid→approved;
    // also ensure pending stays for re-approval if user wants. Here only paid→approved.
    const [otApproved] = await conn.query(
      `SELECT id, workYmd, amountETB, status FROM hr_overtime_request
       WHERE HotelName = ? AND status IN ('approved', 'paid')`,
      [hotelName],
    );
    const [loanRows] = await conn.query(
      `SELECT id, principalETB, remainingETB, installmentETB, status FROM hr_loan
       WHERE HotelName = ?`,
      [hotelName],
    );

    console.log({
      hotelName,
      periodsFound: periods,
      payslipsDeleted: slipRes.affectedRows,
      periodsDeleted: periodRes.affectedRows,
      pendingPayrollDeleted: pendingRes.affectedRows,
      notificationsDeleted: notifRes.affectedRows,
      bonusesRestored: bonusRes.affectedRows,
      advancesRestored: advRes.affectedRows,
      overtimeRestored: otRes.affectedRows,
      loansRestored: loanRes.affectedRows,
      overtimeNow: otApproved,
      loansNow: loanRows,
    });
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
