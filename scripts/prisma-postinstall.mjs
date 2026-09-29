import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = path.join(root, "lib", "prismaClient.generated.js");

function run(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
}

const generate = run("npx", ["prisma", "generate"]);
if (generate.status === 0) {
  const compile = run("node", ["scripts/compile-prisma.mjs"]);
  if (compile.status === 0) {
    process.exit(0);
  }
}

if (existsSync(bundled)) {
  console.warn(
    "[prisma:postinstall] generate/bundle failed; using committed lib/prismaClient.generated.js",
  );
  process.exit(0);
}

console.error(
  "[prisma:postinstall] Prisma client missing and generate failed. Run npm run prisma:bundle locally.",
);
process.exit(1);
