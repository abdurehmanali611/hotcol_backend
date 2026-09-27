/**
 * HR employee chat (emp↔emp, emp↔manager) + Manager/Admin blocks & history.
 * Gated by HR Module. Control APIs: Hotel Manager / Café Admin only.
 */

function actorFromContext(context) {
  const u = context?.user;
  return {
    actorRole: String(u?.Role || "").trim(),
    actorId: Number(u?.id) || null,
    actorName: String(u?.fullName || u?.username || "").trim(),
  };
}

function requireTenant(context, tenantScopeFromContext) {
  const tin = tenantScopeFromContext(context);
  if (!tin) throw new Error("Tenant scope required");
  return tin;
}

function parseModulesJson(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function memberKeyForEmployee(employeeId) {
  return `e:${Number(employeeId)}`;
}

const MANAGER_MEMBER_KEY = "m";

function mapThread(row) {
  if (!row) return null;
  return {
    id: row.id,
    HotelName: row.HotelName,
    kind: row.kind,
    title: row.title || "",
    createdByEmployeeId: row.createdByEmployeeId ?? null,
    createdByManagerUserId: row.createdByManagerUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    members: (row.members || []).map(mapMember),
    lastMessage: row.messages?.[0] ? mapMessage(row.messages[0]) : null,
    messageCount: row._count?.messages ?? row.messages?.length ?? null,
  };
}

function mapMember(row) {
  return {
    id: row.id,
    threadId: row.threadId,
    employeeId: row.employeeId ?? null,
    isManager: Boolean(row.isManager),
    memberKey: row.memberKey,
    joinedAt: row.joinedAt,
    lastReadAt: row.lastReadAt ?? null,
    employeeName: row.employee?.fullName || null,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    threadId: row.threadId,
    senderEmployeeId: row.senderEmployeeId ?? null,
    senderIsManager: Boolean(row.senderIsManager),
    body: row.body || "",
    createdAt: row.createdAt,
    senderName: row.senderIsManager
      ? "Manager"
      : row.sender?.fullName || "Employee",
  };
}

function mapBlock(row) {
  return {
    id: row.id,
    HotelName: row.HotelName,
    pathType: row.pathType,
    employeeIdA: row.employeeIdA,
    employeeIdB: row.employeeIdB ?? null,
    note: row.note || "",
    createdBy: row.createdBy || "",
    createdAt: row.createdAt,
    employeeAName: row.employeeA?.fullName || null,
    employeeBName: row.employeeB?.fullName || null,
  };
}

export const hrChatTypeDefsBlock = `
  type HrChatMember {
    id: Int!
    threadId: Int!
    employeeId: Int
    isManager: Boolean!
    memberKey: String!
    joinedAt: DateTime!
    lastReadAt: DateTime
    employeeName: String
  }

  type HrChatMessage {
    id: Int!
    threadId: Int!
    senderEmployeeId: Int
    senderIsManager: Boolean!
    body: String!
    createdAt: DateTime!
    senderName: String!
  }

  type HrChatThread {
    id: Int!
    HotelName: String!
    kind: String!
    title: String!
    createdByEmployeeId: Int
    createdByManagerUserId: Int
    createdAt: DateTime!
    updatedAt: DateTime!
    members: [HrChatMember!]!
    lastMessage: HrChatMessage
    messageCount: Int
  }

  type HrChatBlock {
    id: Int!
    HotelName: String!
    pathType: String!
    employeeIdA: Int!
    employeeIdB: Int
    note: String!
    createdBy: String!
    createdAt: DateTime!
    employeeAName: String
    employeeBName: String
  }
`;

export const hrChatQueryFields = `
  hrChatThreads: [HrChatThread!]!
  hrChatMessages(threadId: Int!, limit: Int): [HrChatMessage!]!
  hrChatBlocks: [HrChatBlock!]!
  hrChatHistory(
    fromYmd: String
    toYmd: String
    employeeId: Int
    kind: String
    withManager: String
  ): [HrChatThread!]!
  hrChatUnreadCount: Int!
`;

export const hrChatMutationFields = `
  createHrChatDirect(employeeId: Int!, includeManager: Boolean): HrChatThread!
  createHrChatGroup(title: String, employeeIds: [Int!]!, includeManager: Boolean): HrChatThread!
  sendHrChatMessage(threadId: Int!, body: String!): HrChatMessage!
  markHrChatThreadRead(threadId: Int!): HrChatThread!
  createHrChatBlock(pathType: String!, employeeIdA: Int!, employeeIdB: Int, note: String): HrChatBlock!
  deleteHrChatBlock(id: Int!): Boolean!
`;

export function createHrChatResolvers({
  prisma,
  tenantScopeFromContext,
  tenantHotelReadWhere,
  tenantHotelReadMatches,
  assertRole,
  assertAdminOrManager,
  assertAuthenticated,
}) {
  async function assertHrModule(context) {
    const tin = requireTenant(context, tenantScopeFromContext);
    const acct = await prisma.tenant_account.findUnique({
      where: { tinNumber: tin },
      select: { modules: true, businessType: true },
    });
    const mods = parseModulesJson(acct?.modules);
    if (!mods.includes("HR Module")) {
      throw new Error("HR Module is required for chat");
    }
    return { tin, businessType: String(acct?.businessType || "").toLowerCase() };
  }

  /** Hotel Manager or Café Admin — chat control + manager seat. */
  async function assertChatController(context) {
    assertAuthenticated(context);
    const { tin, businessType } = await assertHrModule(context);
    const { actorRole } = actorFromContext(context);
    const isCafe = businessType.includes("cafe") || businessType.includes("restaurant");
    if (isCafe) {
      if (actorRole !== "Admin") {
        throw new Error("Only Admin can manage café employee chat");
      }
    } else if (actorRole !== "Manager") {
      throw new Error("Only Manager can manage hotel employee chat");
    }
    return { tin, businessType, isCafe };
  }

  async function hotelNameForTenant(context) {
    const where = tenantHotelReadWhere(context);
    // Prefer display hotel from a known employee / user HotelName
    const u = context?.user;
    const hn = String(u?.HotelName || "").trim();
    if (hn) return hn;
    const emp = await prisma.hr_employee.findFirst({
      where: typeof where === "object" ? where : { HotelName: where },
      select: { HotelName: true },
    });
    if (emp?.HotelName) return emp.HotelName;
    throw new Error("Could not resolve hotel scope");
  }

  async function loadBlocks(HotelName) {
    return prisma.hr_chat_block.findMany({ where: { HotelName } });
  }

  function pairBlocked(blocks, empA, empB) {
    const a = Number(empA);
    const b = Number(empB);
    for (const bl of blocks) {
      if (bl.pathType !== "emp_emp") continue;
      const x = Number(bl.employeeIdA);
      const y = Number(bl.employeeIdB);
      if ((x === a && y === b) || (x === b && y === a)) return true;
    }
    return false;
  }

  function managerPathBlocked(blocks, employeeId) {
    const e = Number(employeeId);
    return blocks.some(
      (bl) =>
        bl.pathType === "emp_manager" && Number(bl.employeeIdA) === e,
    );
  }

  function assertMembersAllowed(blocks, employeeIds, includeManager, { initiatingAsManager }) {
    const ids = [...new Set(employeeIds.map(Number))].filter((n) => n > 0);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (pairBlocked(blocks, ids[i], ids[j])) {
          throw new Error("A chat block prevents these employees from messaging");
        }
      }
    }
    if (includeManager && !initiatingAsManager) {
      for (const id of ids) {
        if (managerPathBlocked(blocks, id)) {
          throw new Error("A chat block prevents messaging Manager");
        }
      }
    }
  }

  const threadInclude = {
    members: true,
    messages: { orderBy: { createdAt: "desc" }, take: 1 },
    _count: { select: { messages: true } },
  };

  return {
    Query: {
      hrChatThreads: async (_, __, context) => {
        await assertChatController(context);
        const HotelName = await hotelNameForTenant(context);
        const rows = await prisma.hr_chat_thread.findMany({
          where: {
            HotelName,
            members: { some: { isManager: true } },
          },
          include: threadInclude,
          orderBy: { updatedAt: "desc" },
          take: 200,
        });
        return rows.map(mapThread);
      },

      hrChatMessages: async (_, { threadId, limit }, context) => {
        await assertChatController(context);
        const HotelName = await hotelNameForTenant(context);
        const thread = await prisma.hr_chat_thread.findFirst({
          where: { id: Number(threadId), HotelName },
        });
        if (!thread) throw new Error("Thread not found");
        const rows = await prisma.hr_chat_message.findMany({
          where: { threadId: thread.id },
          orderBy: { createdAt: "asc" },
          take: Math.min(Number(limit) || 200, 500),
        });
        return rows.map(mapMessage);
      },

      hrChatBlocks: async (_, __, context) => {
        await assertChatController(context);
        const HotelName = await hotelNameForTenant(context);
        const rows = await prisma.hr_chat_block.findMany({
          where: { HotelName },
          orderBy: { createdAt: "desc" },
        });
        const empIds = [
          ...new Set(
            rows.flatMap((r) =>
              [r.employeeIdA, r.employeeIdB].filter((x) => x != null),
            ),
          ),
        ];
        const emps = empIds.length
          ? await prisma.hr_employee.findMany({
              where: { id: { in: empIds } },
              select: { id: true, fullName: true },
            })
          : [];
        const nameById = new Map(emps.map((e) => [e.id, e.fullName]));
        return rows.map((r) =>
          mapBlock({
            ...r,
            employeeA: { fullName: nameById.get(r.employeeIdA) },
            employeeB: r.employeeIdB
              ? { fullName: nameById.get(r.employeeIdB) }
              : null,
          }),
        );
      },

      hrChatHistory: async (
        _,
        { fromYmd, toYmd, employeeId, kind, withManager },
        context,
      ) => {
        await assertChatController(context);
        const HotelName = await hotelNameForTenant(context);
        const where = { HotelName };
        if (kind === "direct" || kind === "group") where.kind = kind;
        if (withManager === "includes") {
          where.members = { some: { isManager: true } };
        } else if (withManager === "emp_only") {
          where.members = { none: { isManager: true } };
        }
        if (employeeId) {
          where.AND = [
            ...(where.AND || []),
            { members: { some: { employeeId: Number(employeeId) } } },
          ];
        }
        if (fromYmd || toYmd) {
          where.updatedAt = {};
          if (fromYmd) where.updatedAt.gte = new Date(`${fromYmd}T00:00:00`);
          if (toYmd) where.updatedAt.lte = new Date(`${toYmd}T23:59:59`);
        }
        const rows = await prisma.hr_chat_thread.findMany({
          where,
          include: threadInclude,
          orderBy: { updatedAt: "desc" },
          take: 300,
        });
        return rows.map(mapThread);
      },

      hrChatUnreadCount: async (_, __, context) => {
        try {
          await assertChatController(context);
        } catch {
          return 0;
        }
        const HotelName = await hotelNameForTenant(context);
        const memberships = await prisma.hr_chat_member.findMany({
          where: { isManager: true, thread: { HotelName } },
          select: { threadId: true, lastReadAt: true },
        });
        let unread = 0;
        for (const m of memberships) {
          const count = await prisma.hr_chat_message.count({
            where: {
              threadId: m.threadId,
              senderIsManager: false,
              ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
            },
          });
          unread += count > 0 ? 1 : 0;
        }
        return unread;
      },
    },

    Mutation: {
      createHrChatDirect: async (
        _,
        { employeeId, includeManager },
        context,
      ) => {
        await assertChatController(context);
        const HotelName = await hotelNameForTenant(context);
        const { actorId } = actorFromContext(context);
        const emp = await prisma.hr_employee.findFirst({
          where: { id: Number(employeeId), HotelName },
        });
        if (!emp) throw new Error("Employee not found");
        const blocks = await loadBlocks(HotelName);
        // Manager messaging out — block does not stop create
        const withMgr = includeManager !== false;
        const existing = await prisma.hr_chat_thread.findFirst({
          where: {
            HotelName,
            kind: "direct",
            AND: [
              { members: { some: { memberKey: memberKeyForEmployee(emp.id) } } },
              withMgr
                ? { members: { some: { memberKey: MANAGER_MEMBER_KEY } } }
                : {},
            ],
          },
          include: threadInclude,
        });
        if (existing) return mapThread(existing);

        const thread = await prisma.hr_chat_thread.create({
          data: {
            HotelName,
            kind: "direct",
            title: emp.fullName,
            createdByManagerUserId: actorId,
            members: {
              create: [
                {
                  employeeId: emp.id,
                  isManager: false,
                  memberKey: memberKeyForEmployee(emp.id),
                },
                ...(withMgr
                  ? [
                      {
                        employeeId: null,
                        isManager: true,
                        memberKey: MANAGER_MEMBER_KEY,
                      },
                    ]
                  : []),
              ],
            },
          },
          include: threadInclude,
        });
        return mapThread(thread);
      },

      createHrChatGroup: async (
        _,
        { title, employeeIds, includeManager },
        context,
      ) => {
        await assertChatController(context);
        const HotelName = await hotelNameForTenant(context);
        const { actorId } = actorFromContext(context);
        const ids = [...new Set((employeeIds || []).map(Number))].filter(
          (n) => n > 0,
        );
        if (ids.length < 1) throw new Error("Pick at least one employee");
        const blocks = await loadBlocks(HotelName);
        assertMembersAllowed(blocks, ids, false, {
          initiatingAsManager: true,
        });
        const withMgr = Boolean(includeManager);
        const thread = await prisma.hr_chat_thread.create({
          data: {
            HotelName,
            kind: "group",
            title: String(title || "Group").trim().slice(0, 120) || "Group",
            createdByManagerUserId: actorId,
            members: {
              create: [
                ...ids.map((id) => ({
                  employeeId: id,
                  isManager: false,
                  memberKey: memberKeyForEmployee(id),
                })),
                ...(withMgr
                  ? [
                      {
                        employeeId: null,
                        isManager: true,
                        memberKey: MANAGER_MEMBER_KEY,
                      },
                    ]
                  : []),
              ],
            },
          },
          include: threadInclude,
        });
        return mapThread(thread);
      },

      sendHrChatMessage: async (_, { threadId, body }, context) => {
        await assertChatController(context);
        const HotelName = await hotelNameForTenant(context);
        const text = String(body || "").trim().slice(0, 4000);
        if (!text) throw new Error("Message required");
        const thread = await prisma.hr_chat_thread.findFirst({
          where: { id: Number(threadId), HotelName },
          include: { members: true },
        });
        if (!thread) throw new Error("Thread not found");
        const hasManager = thread.members.some((m) => m.isManager);
        if (!hasManager) {
          // Manager can still join by sending — add seat
          await prisma.hr_chat_member.create({
            data: {
              threadId: thread.id,
              isManager: true,
              memberKey: MANAGER_MEMBER_KEY,
            },
          });
        }
        const msg = await prisma.hr_chat_message.create({
          data: {
            threadId: thread.id,
            senderIsManager: true,
            body: text,
          },
        });
        await prisma.hr_chat_thread.update({
          where: { id: thread.id },
          data: { updatedAt: new Date() },
        });
        return mapMessage(msg);
      },

      markHrChatThreadRead: async (_, { threadId }, context) => {
        await assertChatController(context);
        const HotelName = await hotelNameForTenant(context);
        const thread = await prisma.hr_chat_thread.findFirst({
          where: { id: Number(threadId), HotelName },
          include: threadInclude,
        });
        if (!thread) throw new Error("Thread not found");
        await prisma.hr_chat_member.updateMany({
          where: { threadId: thread.id, isManager: true },
          data: { lastReadAt: new Date() },
        });
        const refreshed = await prisma.hr_chat_thread.findUnique({
          where: { id: thread.id },
          include: threadInclude,
        });
        return mapThread(refreshed);
      },

      createHrChatBlock: async (
        _,
        { pathType, employeeIdA, employeeIdB, note },
        context,
      ) => {
        const { actorName } = actorFromContext(context);
        await assertChatController(context);
        const HotelName = await hotelNameForTenant(context);
        const type = String(pathType || "").trim();
        if (type !== "emp_emp" && type !== "emp_manager") {
          throw new Error("pathType must be emp_emp or emp_manager");
        }
        const a = Number(employeeIdA);
        if (!(a > 0)) throw new Error("employeeIdA required");
        let b = employeeIdB != null ? Number(employeeIdB) : null;
        if (type === "emp_emp") {
          if (!(b > 0)) throw new Error("employeeIdB required for emp_emp");
          if (a === b) throw new Error("Pick two different employees");
        } else {
          b = null;
        }
        const row = await prisma.hr_chat_block.create({
          data: {
            HotelName,
            pathType: type,
            employeeIdA: a,
            employeeIdB: b,
            note: String(note || "").trim().slice(0, 500),
            createdBy: actorName,
          },
        });
        return mapBlock(row);
      },

      deleteHrChatBlock: async (_, { id }, context) => {
        await assertChatController(context);
        const HotelName = await hotelNameForTenant(context);
        const row = await prisma.hr_chat_block.findFirst({
          where: { id: Number(id), HotelName },
        });
        if (!row) throw new Error("Block not found");
        await prisma.hr_chat_block.delete({ where: { id: row.id } });
        return true;
      },
    },
  };
}
