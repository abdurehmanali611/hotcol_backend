import "dotenv/config";
import { defineConfig } from "prisma/config";

/** Prefer DATABASE_URL when set; allow `prisma generate` on Vercel without a live DB. */
const databaseUrl =
  process.env.DATABASE_URL?.trim() ||
  "mysql://generate:generate@127.0.0.1:3306/generate";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
});
