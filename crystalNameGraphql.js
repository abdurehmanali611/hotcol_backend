/**
 * CrystalName + CrystalNameProposal — global catalog and Apex review queue.
 * Wired into BackEnd/index.js (types + Query/Mutation fields + resolvers).
 *
 * NON-BLOCKING RULE (product):
 * Apex proposal status (pending / merged / approved / rejected) must NEVER gate
 * tenant workflows — item registration, purchase authorize/approve, stock status,
 * recipe save, orders, etc. Staff save and process rows with the crystal *label
 * string immediately. Apex only maintains the shared naming catalog.
 */

export const crystalNameTypeDefsBlock = `
  type CrystalName {
    id: Int!
    amharic: String!
    romanized: String!
    english: String!
    """Full crystal display: Amharic|Romanized|English"""
    crystalLabel: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type CrystalNameProposal {
    id: Int!
    rawText: String!
    amharic: String!
    romanized: String!
    english: String!
    crystalLabel: String!
    status: String!
    source: String!
    HotelName: String
    tinNumber: String
    proposedBy: String
    mergedIntoId: Int
    reviewNote: String
    reviewedBy: String
    reviewedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }
`;

export const crystalNameQueryFields = `
    """List crystal names (optional search across amharic / romanized / english)."""
    crystalNames(search: String, take: Int, skip: Int): [CrystalName!]!
    crystalName(id: Int!): CrystalName
`;

export const crystalNameMutationFields = `
    createCrystalName(amharic: String!, romanized: String!, english: String!): CrystalName!
    updateCrystalName(id: Int!, amharic: String, romanized: String, english: String): CrystalName!
    deleteCrystalName(id: Int!): Boolean!
    """
    Propose a new crystal for Apex review.
    Only rawText is required — Amharic/Romanized/English are optional;
    Apex completes the triple when approving as new.
    """
    proposeCrystalName(
      rawText: String!
      amharic: String
      romanized: String
      english: String
      source: String
    ): CrystalNameProposal!
`;

function trimField(value, label) {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`${label} is required`);
  if (s.length > 255) throw new Error(`${label} must be at most 255 characters`);
  return s;
}

/** Optional segment for proposals — empty string allowed. */
function optionalSegment(value) {
  const s = String(value ?? "").trim();
  if (s.length > 255) throw new Error("Each name segment must be at most 255 characters");
  return s;
}

function crystalLabel(row) {
  const a = String(row.amharic || "").trim();
  const r = String(row.romanized || "").trim();
  const e = String(row.english || "").trim();
  if (a && r && e) return `${a}|${r}|${e}`;
  const raw = String(row.rawText || "").trim();
  if (raw) return raw;
  return [a, r, e].filter(Boolean).join("|");
}

function mapProposal(row) {
  if (!row) return null;
  return {
    ...row,
    crystalLabel: crystalLabel(row),
  };
}

/**
 * @param {{
 *   prisma: import("./generated/prisma/client.ts").PrismaClient,
 *   assertAuthenticated: (ctx: any) => void,
 *   assertRole: (ctx: any, roles: string[]) => void,
 *   tenantScopeFromContext?: (ctx: any) => string,
 * }} deps
 */
export function createCrystalNameResolvers({
  prisma,
  assertAuthenticated,
  assertRole,
  tenantScopeFromContext,
}) {
  return {
    CrystalName: {
      crystalLabel: (row) => crystalLabel(row),
    },
    CrystalNameProposal: {
      crystalLabel: (row) => crystalLabel(row),
    },
    Query: {
      crystalNames: async (_parent, args, context) => {
        assertAuthenticated(context);
        const take = Math.min(Math.max(Number(args.take) || 500, 1), 2000);
        const skip = Math.max(Number(args.skip) || 0, 0);
        const search = String(args.search || "").trim();

        const where = search
          ? {
              OR: [
                { amharic: { contains: search } },
                { romanized: { contains: search } },
                { english: { contains: search } },
              ],
            }
          : {};

        return prisma.crystalName.findMany({
          where,
          orderBy: [{ english: "asc" }, { romanized: "asc" }, { id: "asc" }],
          take,
          skip,
        });
      },

      crystalName: async (_parent, { id }, context) => {
        assertAuthenticated(context);
        return prisma.crystalName.findUnique({
          where: { id: Number(id) },
        });
      },
    },
    Mutation: {
      createCrystalName: async (_parent, args, context) => {
        assertAuthenticated(context);
        assertRole(context, ["Manager", "Admin"]);

        const amharic = trimField(args.amharic, "amharic");
        const romanized = trimField(args.romanized, "romanized");
        const english = trimField(args.english, "english");

        try {
          return await prisma.crystalName.create({
            data: { amharic, romanized, english },
          });
        } catch (err) {
          if (err?.code === "P2002") {
            throw new Error(
              "A crystal name with this Amharic|Romanized|English already exists",
            );
          }
          throw err;
        }
      },

      updateCrystalName: async (_parent, args, context) => {
        assertAuthenticated(context);
        assertRole(context, ["Manager", "Admin"]);

        const id = Number(args.id);
        const existing = await prisma.crystalName.findUnique({ where: { id } });
        if (!existing) throw new Error("Crystal name not found");

        const data = {};
        if (args.amharic !== undefined && args.amharic !== null) {
          data.amharic = trimField(args.amharic, "amharic");
        }
        if (args.romanized !== undefined && args.romanized !== null) {
          data.romanized = trimField(args.romanized, "romanized");
        }
        if (args.english !== undefined && args.english !== null) {
          data.english = trimField(args.english, "english");
        }
        if (Object.keys(data).length === 0) {
          throw new Error("No fields to update");
        }

        try {
          return await prisma.crystalName.update({
            where: { id },
            data,
          });
        } catch (err) {
          if (err?.code === "P2002") {
            throw new Error(
              "A crystal name with this Amharic|Romanized|English already exists",
            );
          }
          throw err;
        }
      },

      deleteCrystalName: async (_parent, { id }, context) => {
        assertAuthenticated(context);
        assertRole(context, ["Manager", "Admin"]);

        const existing = await prisma.crystalName.findUnique({
          where: { id: Number(id) },
        });
        if (!existing) throw new Error("Crystal name not found");

        await prisma.crystalName.delete({ where: { id: Number(id) } });
        return true;
      },

      proposeCrystalName: async (_parent, args, context) => {
        assertAuthenticated(context);

        const rawText = String(args.rawText || "").trim().slice(0, 512);
        if (!rawText) throw new Error("Typed text is required");

        const amharic = optionalSegment(args.amharic);
        const romanized = optionalSegment(args.romanized);
        const english = optionalSegment(args.english);
        const source = String(args.source || "other")
          .trim()
          .toLowerCase()
          .slice(0, 64) || "other";

        // Only auto-match catalog when a full triple was provided.
        if (amharic && romanized && english) {
          const existingCatalog = await prisma.crystalName.findFirst({
            where: { amharic, romanized, english },
          });
          if (existingCatalog) {
            return mapProposal({
              id: 0,
              rawText,
              amharic: existingCatalog.amharic,
              romanized: existingCatalog.romanized,
              english: existingCatalog.english,
              status: "approved",
              source,
              HotelName: null,
              tinNumber: null,
              proposedBy: null,
              mergedIntoId: existingCatalog.id,
              reviewNote: "Already in catalog",
              reviewedBy: null,
              reviewedAt: new Date(),
              createdAt: existingCatalog.createdAt,
              updatedAt: existingCatalog.updatedAt,
            });
          }
        }

        const pendingSame = await prisma.crystalNameProposal.findFirst({
          where: {
            status: "pending",
            OR: [
              ...(amharic && romanized && english
                ? [{ amharic, romanized, english }]
                : []),
              {
                rawText: {
                  equals: rawText,
                },
              },
            ],
          },
          orderBy: { id: "asc" },
        });
        if (pendingSame) {
          return mapProposal(pendingSame);
        }

        const tin =
          typeof tenantScopeFromContext === "function"
            ? String(tenantScopeFromContext(context) || "").trim() || null
            : String(context?.user?.tinNumber || "").trim() || null;
        const hotel =
          String(context?.user?.HotelName || "").trim() || tin || null;
        const proposedBy =
          String(
            context?.user?.UserName || context?.user?.userName || "",
          ).trim() || null;

        const created = await prisma.crystalNameProposal.create({
          data: {
            rawText,
            amharic,
            romanized,
            english,
            status: "pending",
            source,
            HotelName: hotel,
            tinNumber: tin,
            proposedBy,
          },
        });
        return mapProposal(created);
      },
    },
  };
}
