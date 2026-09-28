/**
 * Unified HR in-app notifications (bell). One channel — no separate announcements.
 */

export async function createHrNotification(
  prisma,
  {
    HotelName,
    recipientRole = "",
    employeeId = null,
    kind,
    title,
    body,
    href = "",
    actionStatus = "",
    createdBy = "",
  },
) {
  const hotel = String(HotelName ?? "").trim();
  if (!hotel) throw new Error("HotelName is required for notification");
  const k = String(kind ?? "").trim();
  if (!k) throw new Error("Notification kind is required");
  const t = String(title ?? "").trim();
  if (!t) throw new Error("Notification title is required");

  return prisma.hr_notification.create({
    data: {
      HotelName: hotel,
      recipientRole: String(recipientRole ?? "").trim(),
      employeeId:
        employeeId != null && Number(employeeId) > 0 ? Number(employeeId) : null,
      kind: k,
      title: t,
      body: String(body ?? "").trim(),
      href: String(href ?? "").trim(),
      actionStatus: String(actionStatus ?? "").trim(),
      createdBy: String(createdBy ?? "").trim(),
    },
  });
}

export async function listHrNotificationsForActor(
  prisma,
  { HotelName, role, employeeId = null, unreadOnly = false },
) {
  const hotel = String(HotelName ?? "").trim();
  const actorRole = String(role ?? "").trim();
  const or = [];
  if (actorRole) {
    or.push({ recipientRole: actorRole });
    // Admin acting as café HR sees HR-targeted items
    if (actorRole === "Admin") {
      or.push({ recipientRole: "HR" });
    }
  }
  if (employeeId != null && Number(employeeId) > 0) {
    or.push({ employeeId: Number(employeeId) });
  }
  if (!or.length) return [];

  const where = {
    HotelName: hotel,
    OR: or,
  };
  if (unreadOnly) {
    where.readAt = null;
  }

  return prisma.hr_notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
}

export async function markHrNotificationRead(
  prisma,
  { id, HotelName, role, employeeId = null },
) {
  const row = await prisma.hr_notification.findUnique({
    where: { id: Number(id) },
  });
  if (!row || row.HotelName !== HotelName) {
    throw new Error("Notification not found");
  }
  const actorRole = String(role ?? "").trim();
  const okRole =
    row.recipientRole &&
    (row.recipientRole === actorRole ||
      (actorRole === "Admin" && row.recipientRole === "HR"));
  const okEmp =
    row.employeeId != null &&
    employeeId != null &&
    Number(row.employeeId) === Number(employeeId);
  if (!okRole && !okEmp) {
    throw new Error("Notification not found");
  }
  if (row.readAt) return row;
  return prisma.hr_notification.update({
    where: { id: row.id },
    data: { readAt: new Date() },
  });
}

export async function createHrEmployeeNotifications(
  prisma,
  { HotelName, employeeIds, title, body, href = "", kind = "hr_message", createdBy = "" },
) {
  const ids = [...new Set((employeeIds || []).map(Number).filter((n) => n > 0))];
  if (!ids.length) throw new Error("Select at least one employee");
  const rows = [];
  for (const employeeId of ids) {
    rows.push(
      await createHrNotification(prisma, {
        HotelName,
        employeeId,
        kind,
        title,
        body,
        href,
        createdBy,
      }),
    );
  }
  return rows;
}

/** Notify leave requester on final approve/reject. */
export async function notifyEmployeeLeaveDecision(
  prisma,
  leave,
  { createdBy = "" } = {},
) {
  const status = String(leave?.status || "");
  if (status !== "approved" && status !== "rejected") return null;
  const approved = status === "approved";
  return createHrNotification(prisma, {
    HotelName: leave.HotelName,
    employeeId: leave.employeeId,
    kind: approved ? "leave_approved" : "leave_rejected",
    title: approved ? "Leave approved" : "Leave rejected",
    body: `Your ${leave.leaveType || "leave"} request (${leave.fromYmd} → ${leave.toYmd}) was ${status}.`,
    href: "/leave",
    createdBy,
  });
}

/** After payroll generate is approved — payslip ready (unpaid). */
export async function notifyEmployeesPayslipReady(
  prisma,
  { HotelName, period, createdBy = "" },
) {
  if (!period?.id) return [];
  const slips = await prisma.hr_payslip.findMany({
    where: { periodId: period.id },
    select: { employeeId: true },
  });
  const label =
    period.monthName ||
    (period.fromYmd && period.toYmd
      ? `${period.fromYmd} → ${period.toYmd}`
      : "this period");
  const rows = [];
  const seen = new Set();
  for (const slip of slips) {
    const eid = Number(slip.employeeId);
    if (!eid || seen.has(eid)) continue;
    seen.add(eid);
    rows.push(
      await createHrNotification(prisma, {
        HotelName,
        employeeId: eid,
        kind: "payslip_ready",
        title: "Your payslip is ready",
        body: `Payslip for ${label} is available. Status: Unpaid.`,
        href: "/payslips",
        createdBy,
      }),
    );
  }
  return rows;
}

/** When Finance/Manager confirms mark paid. */
export async function notifyEmployeesPayslipMarkedPaid(
  prisma,
  payslips,
  { HotelName, createdBy = "" } = {},
) {
  const rows = [];
  const seen = new Set();
  for (const slip of payslips || []) {
    const eid = Number(slip.employeeId);
    if (!eid || seen.has(eid)) continue;
    seen.add(eid);
    const hotel = HotelName || slip.HotelName;
    const label =
      slip.period?.monthName ||
      slip.payslipNumber ||
      (slip.period?.fromYmd
        ? `${slip.period.fromYmd} → ${slip.period.toYmd}`
        : "your payslip");
    rows.push(
      await createHrNotification(prisma, {
        HotelName: hotel,
        employeeId: eid,
        kind: "payslip_marked_paid",
        title: "Payslip marked paid",
        body: `Your payslip (${label}) has been marked paid.`,
        href: "/payslips",
        createdBy,
      }),
    );
  }
  return rows;
}
