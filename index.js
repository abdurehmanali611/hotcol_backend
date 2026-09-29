import express from "express";
import cors from "cors";
import "dotenv/config";

/**
 * Thin Vercel entry: keep / and /health alive even when the GraphQL/Prisma
 * module fails to load, and return the real boot error as JSON (503).
 */
const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "OK",
    service: "hotcol-backend",
    graphql: "/graphql",
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => {
  res.status(200).json({
    status: "OK",
    service: "hotcol-backend",
    graphql: "/graphql",
    health: "/health",
  });
});

let innerApp = null;
let bootError = null;
let loading = null;

function publicBootError(error) {
  const err = error instanceof Error ? error : new Error(String(error ?? ""));
  const code = err.code ? ` [${err.code}]` : "";
  return `${err.message}${code}`;
}

async function loadInnerApp() {
  if (innerApp) return innerApp;
  if (bootError) throw bootError;
  if (loading) return loading;

  loading = (async () => {
    try {
      const mod = await import("./server.js");
      if (!mod?.default) {
        throw new Error("server.js did not export a default Express app");
      }
      innerApp = mod.default;
      return innerApp;
    } catch (error) {
      bootError = error instanceof Error ? error : new Error(String(error));
      console.error("[hotcol-backend] failed to load server.js:", bootError);
      throw bootError;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

app.use((req, res, next) => {
  const path = String(req.path || req.url || "").split("?")[0];
  if (path === "/" || path === "/health") return next();

  loadInnerApp()
    .then((inner) => inner(req, res, next))
    .catch((error) => {
      if (!res.headersSent) {
        res.status(503).json({
          errors: [
            {
              message: publicBootError(error),
              hint: "hotcol-backend failed to boot GraphQL/Prisma — check Vercel logs and DATABASE_URL",
            },
          ],
        });
      }
    });
});

export default app;

if (!process.env.VERCEL) {
  const port = process.env.PORT || 4000;
  loadInnerApp()
    .then(() => {
      app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
