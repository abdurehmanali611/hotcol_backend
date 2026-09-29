import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

// Node's package exports map `import` → client.mjs. Bare
// `@prisma/client/runtime/client` can fail resolution in some serverless
// ESM graphs; pin the .mjs path explicitly after the bundle.
let bundled = readFileSync(outfile, "utf8");
bundled = bundled.replaceAll(
  'from "@prisma/client/runtime/client"',
  'from "@prisma/client/runtime/client.mjs"',
);
bundled = bundled.replaceAll(
  "from '@prisma/client/runtime/client'",
  "from '@prisma/client/runtime/client.mjs'",
);
writeFileSync(outfile, bundled);

console.log(`[prisma:bundle] wrote ${path.relative(root, outfile)}`);
