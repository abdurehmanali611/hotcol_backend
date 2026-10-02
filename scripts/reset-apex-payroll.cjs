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
      "UPDATE hr_overtime_request SET status = 'approved' WHERE HotelName = ? AND status = 'paid'",
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
      note: "Loan remainingETB not restored",
    });
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
