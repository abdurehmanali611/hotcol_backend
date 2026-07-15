/**
 * Remap hotel inventory rows from an old tenant key (TIN / legacy HotelName)
 * onto a new TIN after a legal-name / TIN change.
 *
 * Default tables (requested):
 *   ItemRegistration, PurchaseRequest, StockOutRequest
 *
 * Also remaps linked ledger / voucher / kitchen-bar rows so approvals and
 * stock-outs stay coherent under the destination TIN:
 *   ItemStatus, FreshBazaar, HotelVoucherCounter,
 *   KitchenBarBeginning, KitchenBarMonthlySnapshot
 *
 * Usage (from BackEnd/):
 *   node scripts/remap-tenant-inventory-tin.mjs
 *   node scripts/remap-tenant-inventory-tin.mjs --apply
 *
 * Optional overrides:
 *   --from=0000610789 --to=0108492685
 *   --also=Gebretsadik hotel and spa
 */
import { createPrismaClient } from "../lib/prismaClient.js";

const apply = process.argv.includes("--apply");

function argValue(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

function norm(v) {
  return String(v ?? "").trim();
}

const FROM = norm(argValue("--from", "0000610789"));
const TO = norm(argValue("--to", "0108492685"));
const alsoRaw = argValue("--also", "");
const ALSO = alsoRaw
  ? alsoRaw.split("|").map(norm).filter(Boolean)
  : [];

if (!FROM || !TO || FROM === TO) {
  console.error("Invalid --from / --to");
  process.exit(1);
}

const SOURCE_KEYS = [...new Set([FROM, ...ALSO])];

const prisma = createPrismaClient();

/** @type {{ label: string, model: string, updateMany: (from: string, to: string) => Promise<{count:number}>, count: (key: string) => Promise<number> }[]} */
const TABLES = [
  {
    label: "ItemRegistration",
    count: (k) => prisma.itemRegistration.count({ where: { HotelName: k } }),
    updateMany: (from, to) =>
      prisma.itemRegistration.updateMany({
        where: { HotelName: from },
        data: { HotelName: to },
      }),
  },
  {
    label: "PurchaseRequest",
    count: (k) => prisma.purchaseRequest.count({ where: { HotelName: k } }),
    updateMany: (from, to) =>
      prisma.purchaseRequest.updateMany({
        where: { HotelName: from },
        data: { HotelName: to },
      }),
  },
  {
    label: "StockOutRequest",
    count: (k) => prisma.stockOutRequest.count({ where: { HotelName: k } }),
    updateMany: (from, to) =>
      prisma.stockOutRequest.updateMany({
        where: { HotelName: from },
        data: { HotelName: to },
      }),
  },
  {
    label: "ItemStatus",
    count: (k) => prisma.itemStatus.count({ where: { HotelName: k } }),
    updateMany: (from, to) =>
      prisma.itemStatus.updateMany({
        where: { HotelName: from },
        data: { HotelName: to },
      }),
  },
  {
    label: "FreshBazaar",
    count: (k) => prisma.freshBazaar.count({ where: { HotelName: k } }),
    updateMany: (from, to) =>
      prisma.freshBazaar.updateMany({
        where: { HotelName: from },
        data: { HotelName: to },
      }),
  },
  {
    label: "KitchenBarBeginning",
    count: (k) =>
      prisma.kitchenBarBeginning.count({ where: { HotelName: k } }),
    updateMany: (from, to) =>
      prisma.kitchenBarBeginning.updateMany({
        where: { HotelName: from },
        data: { HotelName: to },
      }),
  },
  {
    label: "KitchenBarMonthlySnapshot",
    count: (k) =>
      prisma.kitchenBarMonthlySnapshot.count({ where: { HotelName: k } }),
    updateMany: (from, to) =>
      prisma.kitchenBarMonthlySnapshot.updateMany({
        where: { HotelName: from },
        data: { HotelName: to },
      }),
  },
];

async function mergeVoucherCounters(from, to) {
  const fromRows = await prisma.hotelVoucherCounter.findMany({
    where: { HotelName: from },
  });
  let merged = 0;
  let moved = 0;
  for (const row of fromRows) {
    const existing = await prisma.hotelVoucherCounter.findUnique({
      where: {
        HotelName_voucherType: {
          HotelName: to,
          voucherType: row.voucherType,
        },
      },
    });
    if (existing) {
      const next = Math.max(
        Number(existing.lastNumber) || 0,
        Number(row.lastNumber) || 0,
      );
      if (apply) {
        await prisma.hotelVoucherCounter.update({
          where: { id: existing.id },
          data: { lastNumber: next },
        });
        await prisma.hotelVoucherCounter.delete({ where: { id: row.id } });
      }
      merged += 1;
      console.log(
        `  [voucher-merge] ${row.voucherType}: max(${existing.lastNumber}, ${row.lastNumber}) → ${next}`,
      );
    } else if (apply) {
      await prisma.hotelVoucherCounter.update({
        where: { id: row.id },
        data: { HotelName: to },
      });
      moved += 1;
      console.log(
        `  [voucher-move] ${row.voucherType} → ${JSON.stringify(to)}`,
      );
    } else {
      moved += 1;
      console.log(
        `  [voucher-move] ${row.voucherType} → ${JSON.stringify(to)} (dry-run)`,
      );
    }
  }
  return { merged, moved, total: fromRows.length };
}

try {
  console.log(
    `${apply ? "APPLY" : "DRY-RUN"} remap ${JSON.stringify(SOURCE_KEYS)} → ${JSON.stringify(TO)}`,
  );

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { tinNumber: { in: [FROM, TO] } },
        { HotelName: { contains: "Gebret" } },
        { HotelName: { contains: "Wa anga" } },
        { HotelName: { contains: "Wa Anga" } },
      ],
    },
    select: {
      id: true,
      UserName: true,
      Role: true,
      HotelName: true,
      tinNumber: true,
    },
  });
  console.log("Matching users:");
  for (const u of users) {
    console.log(
      `  id=${u.id} role=${u.Role} user=${u.UserName} tin=${JSON.stringify(u.tinNumber)} hotel=${JSON.stringify(u.HotelName)}`,
    );
  }

  const destUsers = users.filter((u) => norm(u.tinNumber) === TO);
  if (destUsers.length === 0) {
    console.warn(
      `WARNING: no user rows found with tinNumber=${JSON.stringify(TO)}. Continuing anyway.`,
    );
  }

  // Discover legacy display keys that still hold source inventory under FROM's brand.
  const displayHints = users
    .filter((u) => norm(u.tinNumber) === FROM || norm(u.tinNumber) === TO)
    .map((u) => norm(u.HotelName))
    .filter((h) => h && h !== FROM && h !== TO);

  const discoveryKeys = [...new Set([...SOURCE_KEYS, ...displayHints, ...ALSO])];

  console.log("\nRow counts by HotelName key:");
  /** @type {Map<string, Record<string, number>>} */
  const countsByKey = new Map();
  for (const key of discoveryKeys) {
    /** @type {Record<string, number>} */
    const row = {};
    let total = 0;
    for (const t of TABLES) {
      const n = await t.count(key);
      row[t.label] = n;
      total += n;
    }
    const vc = await prisma.hotelVoucherCounter.count({
      where: { HotelName: key },
    });
    row.HotelVoucherCounter = vc;
    total += vc;
    countsByKey.set(key, row);
    if (total > 0) {
      console.log(`  ${JSON.stringify(key)}`, row);
    }
  }

  // Prefer remapping: FROM tin, then any display name that solely points at FROM
  // (or at TO if legacy rows still use the new brand string).
  const keysToRemap = discoveryKeys.filter((k) => {
    if (k === TO) return false;
    const counts = countsByKey.get(k);
    if (!counts) return false;
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    if (total === 0) return false;
    if (k === FROM) return true;
    if (ALSO.includes(k)) return true;
    // Display names attached to either FROM or TO users — only remap if they
    // still hold inventory under the display string (legacy).
    return displayHints.includes(k);
  });

  if (keysToRemap.length === 0) {
    console.log(
      "\nNothing to remap under discovered keys. Check TINs / display names.",
    );
    process.exit(0);
  }

  console.log(
    `\nWill remap keys → ${JSON.stringify(TO)}:`,
    keysToRemap.map((k) => JSON.stringify(k)).join(", "),
  );

  let grand = 0;
  for (const fromKey of keysToRemap) {
    console.log(`\n=== ${JSON.stringify(fromKey)} → ${JSON.stringify(TO)} ===`);
    for (const t of TABLES) {
      const before = await t.count(fromKey);
      if (before === 0) continue;
      if (apply) {
        const res = await t.updateMany(fromKey, TO);
        console.log(`  ${t.label}: ${res.count} updated`);
        grand += res.count;
      } else {
        console.log(`  ${t.label}: would update ${before}`);
        grand += before;
      }
    }
    const vc = await mergeVoucherCounters(fromKey, TO);
    if (vc.total > 0) {
      console.log(
        `  HotelVoucherCounter: ${vc.moved} move, ${vc.merged} merge`,
      );
      grand += vc.total;
    }
  }

  console.log(
    apply
      ? `\nDone. rowsAffected≈${grand}`
      : `\nDry run complete. wouldAffect≈${grand}. Re-run with --apply to commit.`,
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
