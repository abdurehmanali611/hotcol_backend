/**
 * Helpers for Manager-pending HR actions (F06 terminate, F12 attendance correction, F17 payroll).
 */
export const MANAGER_PENDING_KINDS = [
  "terminate",
  "attendance_correction",
  "payroll_generate",
];

export async function createManagerPendingAction(
  prisma,
  {
    HotelName,
    kind,
    employeeId = null,
    payloadJson = null,
    requestedBy = "",
  },
) {
  if (!MANAGER_PENDING_KINDS.includes(kind)) {
    throw new Error(`Unknown pending action kind: ${kind}`);
  }
  return prisma.hr_manager_pending_action.create({
    data: {
      HotelName: String(HotelName).trim(),
      kind,
      employeeId:
        employeeId != null && Number(employeeId) > 0 ? Number(employeeId) : null,
      payloadJson: payloadJson ?? undefined,
      requestedBy: String(requestedBy || "").trim(),
      status: "pending",
    },
  });
}

export function isDeskManagerOrAdmin(role) {
  const r = String(role || "").trim();
  return r === "Manager" || r === "Admin";
}
