/**
 * One-off: reset Apex Hotel HR payroll runs for retesting.
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  const conn = await mysql.createConnection(url);
  try {
    const [hotelRows] = await conn.query(`
      SELECT HotelName FROM hr_payroll_period WHERE HotelName LIKE '%apex%' COLLATE utf8mb4_general_ci
      UNION
      SELECT HotelName FROM hr_payslip WHERE HotelName LIKE '%apex%' COLLATE utf8mb4_general_ci
      UNION
      SELECT HotelName FROM hr_employee WHERE HotelName LIKE '%apex%' COLLATE utf8mb4_general_ci
      LIMIT 20
    `);
    const names = [...new Set(hotelRows.map((r) => r.HotelName))];
    if (!names.length) {
      console.error("No Apex Hotel found");
      process.exit(1);
    }
    const hotelName = names[0];
    console.log("Resetting payroll for:", hotelName);
    if (names.length > 1) console.log("Other apex matches ignored:", names.slice(1));

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
