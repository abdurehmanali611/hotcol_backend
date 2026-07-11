/** Hotel department codes — one registry row per department; leaderName may list multiple names (comma-separated). */
export const HOTEL_DEPARTMENTS = [
  "KITCHEN",
  "BAR",
  "HOUSE_KEEPING_ROOM",
  "HOUSE_KEEPING_PUBLIC",
  "SECURITY",
  "MAINTENANCE",
  "FINANCE",
  "HR",
  "GM",
  "FB_SERVICE",
  "STORE",
];

/** @deprecated Renamed to HOUSE_KEEPING_ROOM — kept for receipt snapshots. */
export const LEGACY_HOUSE_KEEPING_CODE = "HOUSE_KEEPING";

/** Store staff submitted the request (not a department leader). */
export const STAFF_REQUESTED_BY_CODE = "STAFF";

export const REGISTRATION_RECEIVED_BY_DEPARTMENTS = ["STORE", "KITCHEN", "BAR"];

export const REQUESTED_BY_DEPARTMENTS = [
  STAFF_REQUESTED_BY_CODE,
  ...HOTEL_DEPARTMENTS.filter((d) => d !== "STORE"),
];

/** Purchase requests may be requested by Store as well. */
export const PURCHASE_REQUESTED_BY_DEPARTMENTS = [
  STAFF_REQUESTED_BY_CODE,
  ...HOTEL_DEPARTMENTS,
];

export const DEPARTMENT_LABELS = {
  KITCHEN: "Kitchen",
  BAR: "Bar",
  HOUSE_KEEPING_ROOM: "House Keeping (Room)",
  HOUSE_KEEPING_PUBLIC: "House Keeping (Public)",
  SECURITY: "Security",
  MAINTENANCE: "Maintenance",
  FINANCE: "Finance",
  HR: "Human Resource (HR)",
  GM: "General Manager (GM)",
  FB_SERVICE: "Food and Beverage Service (F&B service)",
  STORE: "Store",
};

const LEGACY_DEPARTMENT_LABELS = {
  [LEGACY_HOUSE_KEEPING_CODE]: DEPARTMENT_LABELS.HOUSE_KEEPING_ROOM,
};

export function normalizeDepartmentCode(code) {
  const key = String(code ?? "").trim();
  if (key === LEGACY_HOUSE_KEEPING_CODE) return "HOUSE_KEEPING_ROOM";
  return key;
}

export function departmentLabel(code) {
  const key = String(code ?? "").trim();
  if (key === STAFF_REQUESTED_BY_CODE) return "Staff";
  if (LEGACY_DEPARTMENT_LABELS[key]) return LEGACY_DEPARTMENT_LABELS[key];
  const normalized = normalizeDepartmentCode(key);
  return DEPARTMENT_LABELS[normalized] ?? key;
}

/**
 * Moves legacy HOUSE_KEEPING leaders to HOUSE_KEEPING_ROOM (same leader name).
 * Safe to run repeatedly.
 */
export async function migrateLegacyHouseKeepingDepartmentLeaders(
  prisma,
  hotelName,
) {
  const tenant = String(hotelName ?? "").trim();
  if (!tenant) return { migrated: false };

  const legacy = await prisma.departmentLeader.findUnique({
    where: {
      HotelName_department: { HotelName: tenant, department: LEGACY_HOUSE_KEEPING_CODE },
    },
  });
  if (!legacy) return { migrated: false };

  const roomExists = await prisma.departmentLeader.findUnique({
    where: {
      HotelName_department: { HotelName: tenant, department: "HOUSE_KEEPING_ROOM" },
    },
  });

  if (roomExists) {
    await prisma.departmentLeader.delete({
      where: {
        HotelName_department: {
          HotelName: tenant,
          department: LEGACY_HOUSE_KEEPING_CODE,
        },
      },
    });
    return { migrated: true, action: "removed_duplicate_legacy" };
  }

  await prisma.departmentLeader.update({
    where: {
      HotelName_department: {
        HotelName: tenant,
        department: LEGACY_HOUSE_KEEPING_CODE,
      },
    },
    data: { department: "HOUSE_KEEPING_ROOM" },
  });
  return { migrated: true, action: "renamed_to_room" };
}

export async function fetchLeaderMap(prisma, hotelName) {
  const tenant = String(hotelName ?? "").trim();
  await migrateLegacyHouseKeepingDepartmentLeaders(prisma, tenant);
  const rows = await prisma.departmentLeader.findMany({
    where: { HotelName: tenant },
  });
  return new Map(rows.map((r) => [r.department, String(r.leaderName ?? "").trim()]));
}

export function assertDepartmentHasLeader(leaderMap, department, label) {
  const code = normalizeDepartmentCode(String(department ?? "").trim());
  let name = leaderMap.get(code);
  if (!name && code === "HOUSE_KEEPING_ROOM") {
    name = leaderMap.get(LEGACY_HOUSE_KEEPING_CODE);
  }
  if (!name) {
    throw new Error(
      `No leader registered for ${label || departmentLabel(code)}. Ask the manager to add one.`,
    );
  }
  return name;
}

function splitLeaderNames(raw) {
  return String(raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Resolve the single accountable leader for a department.
 * Manager may register multiple comma-separated names; the selected one is frozen on the receipt.
 */
export function resolveAccountableLeaderName(
  leaderMap,
  department,
  selectedLeaderName,
  label,
) {
  const registered = splitLeaderNames(
    assertDepartmentHasLeader(leaderMap, department, label),
  );
  const selected = String(selectedLeaderName ?? "").trim();
  if (!selected) {
    if (registered.length === 1) return registered[0];
    throw new Error(
      `Select which ${label || departmentLabel(department)} leader is accountable for this request.`,
    );
  }
  const match = registered.find(
    (n) => n.toLowerCase() === selected.toLowerCase(),
  );
  if (!match) {
    throw new Error(
      `"${selected}" is not a registered leader for ${label || departmentLabel(department)}.`,
    );
  }
  return match;
}

/** Snapshots printed on receipts (frozen at submit). */
export function registrationReceiptSnapshots(
  leaderMap,
  receivedByDepartment,
  receivedByLeaderName,
) {
  const dept = String(receivedByDepartment ?? "").trim();
  return {
    receivedByDepartment: dept,
    receivedByLeaderName: resolveAccountableLeaderName(
      leaderMap,
      dept,
      receivedByLeaderName,
    ),
    financeDeptLeaderName: String(leaderMap.get("FINANCE") ?? "").trim(),
    gmDeptLeaderName: String(leaderMap.get("GM") ?? "").trim(),
  };
}

export function requestReceiptSnapshots(
  leaderMap,
  requestedByDepartment,
  { storeUserName, requestedByLeaderName } = {},
) {
  const dept = normalizeDepartmentCode(String(requestedByDepartment ?? "").trim());
  if (dept === STAFF_REQUESTED_BY_CODE) {
    const name = String(storeUserName ?? "").trim();
    if (!name) {
      throw new Error("Store user name is required when requested by Staff.");
    }
    return {
      requestedByDepartment: STAFF_REQUESTED_BY_CODE,
      requestedByLeaderName: name,
      preparedByLeaderName: assertDepartmentHasLeader(leaderMap, "STORE", "Store"),
      financeDeptLeaderName: String(leaderMap.get("FINANCE") ?? "").trim(),
      gmDeptLeaderName: String(leaderMap.get("GM") ?? "").trim(),
    };
  }
  return {
    requestedByDepartment: dept,
    requestedByLeaderName: resolveAccountableLeaderName(
      leaderMap,
      dept,
      requestedByLeaderName,
    ),
    preparedByLeaderName: assertDepartmentHasLeader(leaderMap, "STORE", "Store"),
    financeDeptLeaderName: String(leaderMap.get("FINANCE") ?? "").trim(),
    gmDeptLeaderName: String(leaderMap.get("GM") ?? "").trim(),
  };
}
