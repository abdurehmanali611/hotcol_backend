/**
 * Sync crystal names from docs/HotCol-Crystal-Naming-Approval.json into crystal_name.
 *
 *   node scripts/sync-crystal-names-from-approval.mjs
 *
 * Inserts unique Amharic|Romanized|English triples from:
 * - observed clusters (crystalName)
 * - recommendedAdditions (section C)
 *
 * Safe to re-run: skips triples that already exist (createMany skipDuplicates).
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createPrismaClient } from "../lib/prismaClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const approvalJson = path.join(
  root,
  "docs",
  "HotCol-Crystal-Naming-Approval.json",
);

function parseCrystalTriple(crystalName) {
  const raw = String(crystalName || "").trim();
  if (!raw) return null;
  const parts = raw.split("|").map((p) => p.trim());
  if (parts.length < 3) return null;
  const amharic = parts[0];
  const romanized = parts[1];
  const english = parts.slice(2).join("|").trim();
  if (!amharic || !romanized || !english) return null;
  if (amharic === "—" || amharic === "-") return null;
  return {
    amharic: amharic.slice(0, 255),
    romanized: romanized.slice(0, 255),
    english: english.slice(0, 255),
  };
}

function tripleKey(t) {
  return `${t.amharic}\u0000${t.romanized}\u0000${t.english}`;
}

async function main() {
  if (!fs.existsSync(approvalJson)) {
    throw new Error(`Approval JSON not found: ${approvalJson}`);
  }

  const pack = JSON.parse(fs.readFileSync(approvalJson, "utf8"));
  /** @type {Map<string, { amharic: string, romanized: string, english: string }>} */
  const unique = new Map();

  for (const c of pack.clusters || []) {
    const t = parseCrystalTriple(c.crystalName);
    if (t) unique.set(tripleKey(t), t);
  }
  for (const r of pack.recommendedAdditions || []) {
    const t =
      parseCrystalTriple(r.crystalName) ||
      (r.am && r.rom && r.en
        ? {
            amharic: String(r.am).trim().slice(0, 255),
            romanized: String(r.rom).trim().slice(0, 255),
            english: String(r.en).trim().slice(0, 255),
          }
        : null);
    if (t && t.amharic && t.romanized && t.english && t.amharic !== "—") {
      unique.set(tripleKey(t), t);
    }
  }

  const rows = [...unique.values()];
  console.log(`Unique crystal triples from approval pack: ${rows.length}`);
  console.log(`Source: ${approvalJson}`);

  const prisma = createPrismaClient();
  try {
    const before = await prisma.crystalName.count();
    console.log(`DB rows before: ${before}`);

    let inserted = 0;
    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const result = await prisma.crystalName.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      inserted += result.count;
      console.log(
        `Batch ${Math.floor(i / chunkSize) + 1}: +${result.count} (progress ${Math.min(i + chunk.length, rows.length)}/${rows.length})`,
      );
    }

    const after = await prisma.crystalName.count();
    console.log(
      `Done. newlyInserted≈${inserted} dbTotal=${after} (re-run safe via skipDuplicates)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
