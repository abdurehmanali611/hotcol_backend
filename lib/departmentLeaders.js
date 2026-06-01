/** Fixed hotel department codes — one leader per department per property. */
export const HOTEL_DEPARTMENTS = [
  "KITCHEN",
  "BAR",
  "HOUSE_KEEPING",
  "SECURITY",
  "MAINTENANCE",
  "FINANCE",
  "HR",
  "GM",
  "FB_SERVICE",
  "STORE",
];

export const REGISTRATION_RECEIVED_BY_DEPARTMENTS = ["STORE", "KITCHEN", "BAR"];

export const REQUESTED_BY_DEPARTMENTS = HOTEL_DEPARTMENTS.filter(
  (d) => d !== "STORE",
);

export const DEPARTMENT_LABELS = {
  KITCHEN: "Kitchen",
  BAR: "Bar",
  HOUSE_KEEPING: "House Keeping",
  SECURITY: "Security",
  MAINTENANCE: "Maintenance",
  FINANCE: "Finance",
  HR: "Human Resource (HR)",
  GM: "General Manager (GM)",
  FB_SERVICE: "Food and Beverage Service (F&B service)",
  STORE: "Store",
};

export function departmentLabel(code) {
  return DEPARTMENT_LABELS[String(code ?? "").trim()] ?? String(code ?? "").trim();
}

export async function fetchLeaderMap(prisma, hotelName) {
  const tenant = String(hotelName ?? "").trim();
  const rows = await prisma.departmentLeader.findMany({
    where: { HotelName: tenant },
  });
  return new Map(rows.map((r) => [r.department, String(r.leaderName ?? "").trim()]));
}

export function assertDepartmentHasLeader(leaderMap, department, label) {
  const code = String(department ?? "").trim();
  const name = leaderMap.get(code);
  if (!name) {
    throw new Error(
      `No leader registered for ${label || departmentLabel(code)}. Ask the manager to add one.`,
    );
  }
  return name;
}

/** Snapshots printed on receipts (frozen at submit). */
export function registrationReceiptSnapshots(leaderMap, receivedByDepartment) {
  const dept = String(receivedByDepartment ?? "").trim();
  return {
    receivedByDepartment: dept,
    receivedByLeaderName: assertDepartmentHasLeader(leaderMap, dept),
    financeDeptLeaderName: String(leaderMap.get("FINANCE") ?? "").trim(),
    gmDeptLeaderName: String(leaderMap.get("GM") ?? "").trim(),
  };
}

export function requestReceiptSnapshots(leaderMap, requestedByDepartment) {
  const dept = String(requestedByDepartment ?? "").trim();
  return {
    requestedByDepartment: dept,
    requestedByLeaderName: assertDepartmentHasLeader(leaderMap, dept),
    preparedByLeaderName: assertDepartmentHasLeader(leaderMap, "STORE", "Store"),
    financeDeptLeaderName: String(leaderMap.get("FINANCE") ?? "").trim(),
    gmDeptLeaderName: String(leaderMap.get("GM") ?? "").trim(),
  };
}
