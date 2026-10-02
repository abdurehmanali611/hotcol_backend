/**
 * Reset Apex Hotel approved/paid compensation so approval + payroll can be retested.
 * - bonuses / advances / OT: approved|paid → pending
 * - loans: active|closed → pending, remainingETB = principalETB
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
      "Resetting compensation for:",
      tenantRows[0].hotelDisplayName,
      `(HotelName/TIN ${hotelName})`,
    );

    const [before] = await conn.query(
      `SELECT
         (SELECT COUNT(*) FROM hr_bonus WHERE HotelName = ? AND status IN ('approved','paid')) AS bonuses,
         (SELECT COUNT(*) FROM hr_advance_request WHERE HotelName = ? AND status IN ('approved','paid')) AS advances,
         (SELECT COUNT(*) FROM hr_overtime_request WHERE HotelName = ? AND status IN ('approved','paid')) AS overtime,
         (SELECT COUNT(*) FROM hr_loan WHERE HotelName = ? AND status IN ('active','closed')) AS loans`,
      [hotelName, hotelName, hotelName, hotelName],
    );
    console.log("before", before[0]);

    const [bonusRes] = await conn.query(
      `UPDATE hr_bonus
       SET status = 'pending', decidedBy = '', decidedAt = NULL
       WHERE HotelName = ? AND status IN ('approved', 'paid')`,
      [hotelName],
    );
    const [advRes] = await conn.query(
      `UPDATE hr_advance_request
       SET status = 'pending', decidedBy = '', decidedAt = NULL
       WHERE HotelName = ? AND status IN ('approved', 'paid')`,
      [hotelName],
    );
    const [otRes] = await conn.query(
      `UPDATE hr_overtime_request
       SET status = 'pending', decidedBy = '', decidedAt = NULL
       WHERE HotelName = ? AND status IN ('approved', 'paid')`,
      [hotelName],
    );
    const [loanRes] = await conn.query(
      `UPDATE hr_loan
       SET status = 'pending', remainingETB = principalETB, decidedBy = '', decidedAt = NULL
       WHERE HotelName = ? AND status IN ('active', 'closed')`,
      [hotelName],
    );

    console.log({
      hotelName,
      bonusesReset: bonusRes.affectedRows,
      advancesReset: advRes.affectedRows,
      overtimeReset: otRes.affectedRows,
      loansReset: loanRes.affectedRows,
    });
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
