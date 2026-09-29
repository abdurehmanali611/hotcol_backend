import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "generated", "prisma", "client.ts");
const outfile = path.join(root, "lib", "prismaClient.generated.js");

if (!existsSync(entry)) {
  throw new Error(
    `Prisma client was not generated at ${entry}. Run prisma generate first.`,
  );
}

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "esbuild",
    entry,
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${outfile}`,
    "--packages=external",
    "--target=node20",
  ],
  { cwd: root, stdio: "inherit", shell: true },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[prisma:bundle] wrote ${path.relative(root, outfile)}`);
