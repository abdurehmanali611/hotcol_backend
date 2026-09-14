/**
 * Apply romanized spelling fixes to crystal_name (and report hits).
 *
 *   node scripts/fix-crystal-romanized-spellings.mjs --dry-run
 *   node scripts/fix-crystal-romanized-spellings.mjs --confirm
 */
import { createPrismaClient } from "../lib/prismaClient.js";

/** Exact romanized replacements (case-insensitive match on romanized field). */
const EXACT_ROMANIZED = [
  { from: /^fasoliya$/i, to: "Fosoliya" },
  { from: /^shero$/i, to: "Shro" },
  { from: /^key shenkurt$/i, to: "Key Shnkurt" },
  { from: /^keberet$/i, to: "Kbrit" },
  { from: /^baro shenkurt$/i, to: "Baro Shnkurt" },
  { from: /^stro$/i, to: "Straw" },
  { from: /^nech shenkurt$/i, to: "Nech Shnkurt" },
];

/** Substring fixes inside romanized (and english when clearly takeaway plastic). */
const SUBSTRING_FIXES = [
  { from: /tekaway/gi, to: "takeaway" },
  { from: /Tekaway/g, to: "Takeaway" },
  { from: /tekawey/gi, to: "takeaway" },
  { from: /Tekawey/g, to: "Takeaway" },
];

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    confirm: argv.includes("--confirm"),
  };
}

function applyExact(romanized) {
  const raw = String(romanized || "").trim();
  for (const rule of EXACT_ROMANIZED) {
    if (rule.from.test(raw)) return rule.to;
  }
  return null;
}

function applySubstrings(text) {
  let next = String(text || "");
  let changed = false;
  for (const rule of SUBSTRING_FIXES) {
    const after = next.replace(rule.from, rule.to);
    if (after !== next) {
      next = after;
      changed = true;
    }
  }
  return changed ? next : null;
}

async function main() {
  const { dryRun, confirm } = parseArgs(process.argv.slice(2));
  if (!dryRun && !confirm) {
    console.error("Pass --dry-run or --confirm");
    process.exit(1);
  }

  const prisma = createPrismaClient();
  try {
    const rows = await prisma.crystalName.findMany({
      select: {
        id: true,
        amharic: true,
        romanized: true,
        english: true,
      },
    });

    const updates = [];
    for (const row of rows) {
      let romanized = row.romanized;
      let english = row.english;
      let touched = false;

      const exact = applyExact(romanized);
      if (exact && exact !== romanized) {
        romanized = exact;
        touched = true;
      }

      const subR = applySubstrings(romanized);
      if (subR && subR !== romanized) {
        romanized = subR;
        touched = true;
      }

      const subE = applySubstrings(english);
      if (subE && subE !== english) {
        english = subE;
        touched = true;
      }

      // Also catch romanized that contains phrases (not only exact)
  // Prefer Title-Case replacements for takeaway tokens
  const phraseFixes = [
    [/fasoliya/gi, "Fosoliya"],
    [/\bshero\b/gi, "Shro"],
    [/key shenkurt/gi, "Key Shnkurt"],
    [/\bkeberet\b/gi, "Kbrit"],
    [/baro shenkurt/gi, "Baro Shnkurt"],
    [/\bstro\b/gi, "Straw"],
    [/nech shenkurt/gi, "Nech Shnkurt"],
    [/tekawey/gi, "Takeaway"],
    [/tekaway/gi, "Takeaway"],
  ];
  let r2 = romanized;
  for (const [re, rep] of phraseFixes) {
    const after = r2.replace(re, rep);
    if (after !== r2) {
      r2 = after;
      touched = true;
    }
  }
  // Normalize accidental lowercase takeaway mid-string
  r2 = r2.replace(/takeaway/gi, "Takeaway");
  if (r2 !== romanized) {
    romanized = r2;
    touched = true;
  } else {
    romanized = r2;
  }

      if (!touched) continue;
      if (romanized === row.romanized && english === row.english) continue;

      updates.push({
        id: row.id,
        before: `${row.amharic}|${row.romanized}|${row.english}`,
        after: `${row.amharic}|${romanized}|${english}`,
        data: { romanized, english },
      });
    }

    console.log(`Matched ${updates.length} crystal rows`);
    for (const u of updates) {
      console.log(`- ${u.before}`);
      console.log(`  → ${u.after}`);
    }

    if (dryRun) {
      console.log("\nDry run only — no writes.");
      return;
    }

    for (const u of updates) {
      // Avoid unique triple collisions
      const clash = await prisma.crystalName.findFirst({
        where: {
          amharic: updates.find((x) => x.id === u.id)
            ? undefined
            : undefined,
        },
      });
      void clash;
      const current = await prisma.crystalName.findUnique({
        where: { id: u.id },
      });
      if (!current) continue;
      const existing = await prisma.crystalName.findFirst({
        where: {
          amharic: current.amharic,
          romanized: u.data.romanized,
          english: u.data.english,
          NOT: { id: u.id },
        },
      });
      if (existing) {
        console.warn(
          `Skip id=${u.id} — would collide with id=${existing.id} (${u.after})`,
        );
        continue;
      }
      await prisma.crystalName.update({
        where: { id: u.id },
        data: u.data,
      });
    }

    console.log("\nDone.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
