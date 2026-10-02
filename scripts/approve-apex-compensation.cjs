/**
 * Set Apex Hotel compensation to ready-for-payroll (except salary changes).
 * - bonus / advance / OT: pending|paid → approved
 * - loan: pending|closed → active, remaining = principal (keep installment if > 0)
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
      "Approving compensation for:",
      tenantRows[0].hotelDisplayName,
      `(${hotelName})`,
    );

    const [before] = await conn.query(
      `SELECT
         (SELECT COUNT(*) FROM hr_bonus WHERE HotelName = ?) AS bonuses,
         (SELECT COUNT(*) FROM hr_advance_request WHERE HotelName = ?) AS advances,
         (SELECT COUNT(*) FROM hr_overtime_request WHERE HotelName = ?) AS overtime,
         (SELECT COUNT(*) FROM hr_loan WHERE HotelName = ?) AS loans,
         (SELECT COUNT(*) FROM hr_salary_history WHERE HotelName = ?) AS salary`,
      [hotelName, hotelName, hotelName, hotelName, hotelName],
    );
    console.log("counts", before[0]);

    const [bonusRes] = await conn.query(
      `UPDATE hr_bonus
       SET status = 'approved', decidedBy = 'reset-script', decidedAt = NOW()
       WHERE HotelName = ? AND status IN ('pending', 'paid', 'rejected')`,
      [hotelName],
    );
    const [advRes] = await conn.query(
      `UPDATE hr_advance_request
       SET status = 'approved', decidedBy = 'reset-script', decidedAt = NOW()
       WHERE HotelName = ? AND status IN ('pending', 'paid', 'rejected')`,
      [hotelName],
    );
    const [otRes] = await conn.query(
      `UPDATE hr_overtime_request
       SET status = 'approved', decidedBy = 'reset-script', decidedAt = NOW()
       WHERE HotelName = ? AND status IN ('pending', 'paid', 'rejected')`,
      [hotelName],
    );
    const [loanRes] = await conn.query(
      `UPDATE hr_loan
       SET status = 'active',
           remainingETB = principalETB,
           installmentETB = CASE
             WHEN installmentETB IS NULL OR installmentETB <= 0 THEN principalETB
             ELSE installmentETB
           END,
           decidedBy = 'reset-script',
           decidedAt = NOW()
       WHERE HotelName = ? AND status IN ('pending', 'closed', 'rejected', 'active')`,
      [hotelName],
    );

    const [after] = await conn.query(
      `SELECT
         (SELECT GROUP_CONCAT(CONCAT(id, ':', status) SEPARATOR ', ')
            FROM hr_bonus WHERE HotelName = ?) AS bonuses,
         (SELECT GROUP_CONCAT(CONCAT(id, ':', status) SEPARATOR ', ')
            FROM hr_advance_request WHERE HotelName = ?) AS advances,
         (SELECT GROUP_CONCAT(CONCAT(id, ':', workYmd, ':', status) SEPARATOR ', ')
            FROM hr_overtime_request WHERE HotelName = ?) AS overtime,
         (SELECT GROUP_CONCAT(CONCAT(id, ':', status, ':rem', remainingETB, ':inst', installmentETB) SEPARATOR ', ')
            FROM hr_loan WHERE HotelName = ?) AS loans`,
      [hotelName, hotelName, hotelName, hotelName],
    );

    console.log({
      bonusesUpdated: bonusRes.affectedRows,
      advancesUpdated: advRes.affectedRows,
      overtimeUpdated: otRes.affectedRows,
      loansUpdated: loanRes.affectedRows,
      salaryLeftUntouched: true,
      after: after[0],
    });
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
