/**
 * CrystalName — global catalog of Amharic|Romanized|English product names.
 * Source for inventory / recipe / purchase selector options.
 * Wired into BackEnd/index.js (types + Query/Mutation fields + resolvers).
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
`;

function trimField(value, label) {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`${label} is required`);
  if (s.length > 255) throw new Error(`${label} must be at most 255 characters`);
  return s;
}

function crystalLabel(row) {
  return `${row.amharic}|${row.romanized}|${row.english}`;
}

/**
 * @param {{
 *   prisma: import("./generated/prisma/client.ts").PrismaClient,
 *   assertAuthenticated: (ctx: any) => void,
 *   assertRole: (ctx: any, roles: string[]) => void,
 * }} deps
 */
export function createCrystalNameResolvers({
  prisma,
  assertAuthenticated,
  assertRole,
}) {
  return {
    CrystalName: {
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
    },
  };
}
