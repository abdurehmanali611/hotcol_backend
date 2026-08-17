export const DEFAULT_CAFE_ORDER_MODE = "digital";
export const CAFE_MODULE_NAME = "Cafe and Restaurant";

export function cafeModuleSelected(modules) {
  if (!Array.isArray(modules)) return false;
  return modules.some((item) => String(item).trim() === CAFE_MODULE_NAME);
}

export function cafeOrderModeNoteLine(mode) {
  return `[Cafe order mode: ${parseCafeOrderMode(mode)}]`;
}

export function parseCafeOrderModeFromRequestNote(requestNote) {
  const match = /\[Cafe order mode:\s*(digital|analog)\]/i.exec(
    String(requestNote || ""),
  );
  return match ? parseCafeOrderMode(match[1]) : null;
}

export function cafeOrderModeForModules(modules, storedMode) {
  if (!cafeModuleSelected(modules)) return null;
  return parseCafeOrderMode(storedMode);
}

export function parseCafeOrderMode(raw) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return value === "analog" ? "analog" : "digital";
}

export function parseCafeOrderModeHistory(raw) {
  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = null;
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const from = row.effectiveFrom != null ? String(row.effectiveFrom) : "";
      if (!from) return null;
      return {
        mode: parseCafeOrderMode(row.mode),
        effectiveFrom: from,
        effectiveTo:
          row.effectiveTo == null || row.effectiveTo === ""
            ? null
            : String(row.effectiveTo),
      };
    })
    .filter(Boolean);
}

export function initialCafeOrderModeHistory(mode, at) {
  const when = at instanceof Date ? at : new Date(at || Date.now());
  return [
    {
      mode: parseCafeOrderMode(mode),
      effectiveFrom: when.toISOString(),
      effectiveTo: null,
    },
  ];
}

export function applyCafeOrderModeChange(history, nextMode, at) {
  const when = at instanceof Date ? at : new Date(at || Date.now());
  const iso = when.toISOString();
  const next = parseCafeOrderMode(nextMode);
  const list = parseCafeOrderModeHistory(history).map((row) => ({ ...row }));
  const last = list[list.length - 1];
  if (last && !last.effectiveTo) last.effectiveTo = iso;
  if (last && last.mode === next) {
    last.effectiveTo = null;
    return list;
  }
  list.push({
    mode: next,
    effectiveFrom: iso,
    effectiveTo: null,
  });
  return list;
}

export async function loadTenantCafeOrderMode(prismaClient, tinNumber) {
  const tin = String(tinNumber || "").trim();
  if (!tin) return DEFAULT_CAFE_ORDER_MODE;
  const account = await prismaClient.tenant_account.findUnique({
    where: { tinNumber: tin },
    select: { cafeOrderMode: true },
  });
  return parseCafeOrderMode(account?.cafeOrderMode);
}

export function cafeOrderModeSnapshot(account, createdAt) {
  const mode = parseCafeOrderMode(account?.cafeOrderMode);
  const history = parseCafeOrderModeHistory(account?.cafeOrderModeHistory);
  if (history.length > 0) {
    return { cafeOrderMode: mode, cafeOrderModeHistory: history };
  }
  const from =
    createdAt instanceof Date
      ? createdAt.toISOString()
      : createdAt
        ? new Date(createdAt).toISOString()
        : new Date(0).toISOString();
  return {
    cafeOrderMode: mode,
    cafeOrderModeHistory: initialCafeOrderModeHistory(mode, from),
  };
}
