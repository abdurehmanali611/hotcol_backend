/**
 * One-off: reset Apex Hotel HR payroll runs for retesting compensation→payroll.
 * Does NOT touch other hotels. Reverts paid bonuses/advances/OT so they re-apply.
 * Loan remaining balances are left as-is (cannot safely reverse without history).
 */
import "dotenv/config";
import pkg from "@prisma/client";

const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
  const hotels = await prisma.hr_payroll_period.findMany({
    distinct: ["HotelName"],
    select: { HotelName: true },
  });
  const slipHotels = await prisma.hr_payslip.findMany({
    distinct: ["HotelName"],
    select: { HotelName: true },
  });
  const allNames = [
    ...new Set([
      ...hotels.map((h) => h.HotelName),
      ...slipHotels.map((h) => h.HotelName),
    ]),
  ];
  const apexNames = allNames.filter((n) =>
    String(n || "")
      .toLowerCase()
      .includes("apex"),
  );

  // Also match tenant display even if no periods yet
  let hotelName = apexNames[0] || null;
  if (!hotelName) {
    const emp = await prisma.hr_employee.findFirst({
      where: { HotelName: { contains: "apex" } },
      select: { HotelName: true },
    });
    hotelName = emp?.HotelName || null;
  }
  if (!hotelName) {
    // MySQL Prisma contains is case-sensitive depending on collation — try common labels
    for (const candidate of ["APEX HOTEL", "Apex Hotel", "Apex hotel", "apex hotel"]) {
      const hit = await prisma.hr_employee.findFirst({
        where: { HotelName: candidate },
        select: { HotelName: true },
      });
      if (hit) {
        hotelName = hit.HotelName;
        break;
      }
    }
  }
  if (!hotelName) {
    console.error("No Apex Hotel tenant found among payroll/employee rows.");
    console.error("Known payroll hotels:", allNames);
    process.exit(1);
  }

  console.log(`Resetting payroll for HotelName=${JSON.stringify(hotelName)}`);

  const periods = await prisma.hr_payroll_period.findMany({
    where: { HotelName: hotelName },
    select: { id: true, fromYmd: true, toYmd: true, status: true },
  });
  const periodIds = periods.map((p) => p.id);

  const deletedSlips = await prisma.hr_payslip.deleteMany({
    where: { HotelName: hotelName },
  });
  const deletedPeriods = await prisma.hr_payroll_period.deleteMany({
    where: { HotelName: hotelName },
  });

  const pendingPayroll = await prisma.hr_manager_pending_action.deleteMany({
    where: {
      HotelName: hotelName,
      kind: "payroll_generate",
    },
  });

  const notif = await prisma.hr_notification.deleteMany({
    where: {
      HotelName: hotelName,
      kind: {
        in: [
          "manager_pending_payroll",
          "payroll_generate",
          "payroll_payment",
        ],
      },
    },
  });

  const bonuses = await prisma.hr_bonus.updateMany({
    where: { HotelName: hotelName, status: "paid" },
    data: { status: "approved" },
  });
  const advances = await prisma.hr_advance_request.updateMany({
    where: { HotelName: hotelName, status: "paid" },
    data: { status: "approved" },
  });
  const overtime = await prisma.hr_overtime_request.updateMany({
    where: { HotelName: hotelName, status: "paid" },
    data: { status: "approved" },
  });

  console.log({
    hotelName,
    periodsRemoved: deletedPeriods.count,
    payslipsRemoved: deletedSlips.count,
    periodIds,
    pendingPayrollActionsRemoved: pendingPayroll.count,
    notificationsRemoved: notif.count,
    bonusesRestoredToApproved: bonuses.count,
    advancesRestoredToApproved: advances.count,
    overtimeRestoredToApproved: overtime.count,
    note: "Active loan remainingETB was not restored.",
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
