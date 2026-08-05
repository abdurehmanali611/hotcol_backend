import "dotenv/config";
import { createPrismaClient } from "../lib/prismaClient.js";

const p = createPrismaClient();
const t0 = Date.now();
try {
  const n = await p.user.count();
  console.log("count", n, `${Date.now() - t0}ms`);
} catch (e) {
  console.error("FAIL", `${Date.now() - t0}ms`, e.message);
  process.exitCode = 1;
} finally {
  await p.$disconnect();
}
