export function mapSalesAgentRow(row) {
  return {
    id: row.id,
    displayName: row.displayName,
    phone: row.phone ?? null,
    city: row.city ?? null,
    isActive: Boolean(row.isActive),
  };
}

export async function resolveActiveSalesAgentId(prismaClient, salesAgentId) {
  if (salesAgentId == null || salesAgentId === "") return null;
  const id = Number(salesAgentId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await prismaClient.sales_agent.findUnique({ where: { id } });
  if (!row) throw new Error("Selected sales agent was not found");
  if (!row.isActive) throw new Error("That sales agent is no longer active");
  return id;
}

export async function listActiveSalesAgents(prismaClient) {
  const rows = await prismaClient.sales_agent.findMany({
    where: { isActive: true },
    orderBy: { displayName: "asc" },
  });
  return rows.map(mapSalesAgentRow);
}
