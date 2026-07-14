/**
 * Lodging — Room Management + Cleaning & Maintenance GraphQL API.
 * Wired into BackEnd/index.js (types + Query/Mutation fields + resolvers).
 */

const ROOM_STATUSES = new Set([
  "vacant_dirty",
  "occupied",
  "vacant_clean",
  "on_maintenance",
]);
const STAY_STATUSES = new Set([
  "reserved",
  "checked_in",
  "checked_out",
  "cancelled",
]);
const BILL_STATUSES = new Set(["open", "settled", "void"]);
const BILL_LINE_KINDS = new Set(["room", "food_drink", "laundry", "other"]);
const SERVICE_KINDS = new Set(["food_drink", "laundry"]);
const CM_WORK_KINDS = new Set(["cleaning", "maintenance"]);
const CM_STATUSES = new Set(["open", "done", "cancelled"]);

const STAY_INCLUDE = {
  guest: true,
  rooms: { include: { room: true } },
  bill: { include: { lines: { orderBy: { id: "asc" } } } },
};

export const lodgingTypeDefsBlock = `
  type LodgingRoom {
    id: Int!
    HotelName: String!
    roomNumber: String!
    roomType: String!
    floor: String!
    pricePerNightETB: Float!
    status: String!
    maintenanceUntil: DateTime
    notes: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    createdBy: String!
    updatedBy: String!
  }

  type LodgingGuest {
    id: Int!
    HotelName: String!
    firstName: String!
    lastName: String!
    sex: String!
    phone: String!
    phoneSecondary: String!
    email: String!
    isEthiopian: Boolean!
    nationalId: String!
    passportNumber: String!
    country: String!
    stateRegion: String!
    addressLine: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type LodgingStayRoom {
    id: Int!
    stayId: Int!
    roomId: Int!
    roomType: String!
    createdAt: DateTime!
    room: LodgingRoom!
  }

  type LodgingBillLine {
    id: Int!
    billId: Int!
    kind: String!
    description: String!
    quantity: Float!
    unitPriceETB: Float!
    amountETB: Float!
    roomNumber: String!
    createdAt: DateTime!
    createdBy: String!
  }

  type LodgingBill {
    id: Int!
    HotelName: String!
    stayId: Int!
    status: String!
    totalETB: Float!
    settledAt: DateTime
    settledBy: String!
    receiptNumber: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    lines: [LodgingBillLine!]!
  }

  type LodgingStay {
    id: Int!
    HotelName: String!
    voucherCode: String!
    guestId: Int!
    status: String!
    arrivalAt: DateTime!
    departureAt: DateTime!
    nights: Int!
    adults: Int!
    children: Int!
    preferredRoomType: String!
    notes: String!
    checkedInBy: String!
    checkedOutBy: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    guest: LodgingGuest!
    rooms: [LodgingStayRoom!]!
    bill: LodgingBill
  }

  type LodgingServiceItem {
    id: Int!
    HotelName: String!
    kind: String!
    name: String!
    unitPriceETB: Float!
    unitLabel: String!
    isActive: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type LodgingCmAssignment {
    id: Int!
    HotelName: String!
    roomId: Int!
    workKind: String!
    assigneeName: String!
    notes: String!
    status: String!
    assignedBy: String!
    completedBy: String!
    completedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    room: LodgingRoom!
  }

  type LodgingActionLog {
    id: Int!
    HotelName: String!
    actorRole: String!
    actorName: String!
    action: String!
    entityType: String!
    entityId: Int
    stayId: Int
    detailJson: String!
    createdAt: DateTime!
  }

  type LodgingDashboardStats {
    vacantClean: Int!
    vacantDirty: Int!
    occupied: Int!
    onMaintenance: Int!
    activeStays: Int!
    openCmAssignments: Int!
  }

  input LodgingGuestInput {
    id: Int
    firstName: String!
    lastName: String!
    sex: String
    phone: String!
    phoneSecondary: String
    email: String
    isEthiopian: Boolean
    nationalId: String
    passportNumber: String
    country: String
    stateRegion: String
    addressLine: String
  }
`;

export const lodgingQueryFields = `
    lodgingRooms: [LodgingRoom!]!
    lodgingRoomsByStatus(status: String!): [LodgingRoom!]!
    lodgingCmQueue: [LodgingRoom!]!
    lodgingGuests(search: String): [LodgingGuest!]!
    lodgingGuest(id: Int!): LodgingGuest
    lodgingActiveStays: [LodgingStay!]!
    lodgingStay(id: Int!): LodgingStay
    lodgingStaysByDate(from: DateTime!, to: DateTime!): [LodgingStay!]!
    lodgingServiceItems(kind: String): [LodgingServiceItem!]!
    lodgingCmAssignments(status: String): [LodgingCmAssignment!]!
    lodgingActionLogs(limit: Int, stayId: Int): [LodgingActionLog!]!
    lodgingDashboardStats: LodgingDashboardStats!
`;

export const lodgingMutationFields = `
    createLodgingRoom(
      roomNumber: String!
      roomType: String!
      floor: String
      pricePerNightETB: Float!
      notes: String
    ): LodgingRoom!
    updateLodgingRoom(
      id: Int!
      roomNumber: String
      roomType: String
      floor: String
      pricePerNightETB: Float
      notes: String
      status: String
      maintenanceUntil: DateTime
    ): LodgingRoom!
    deleteLodgingRoom(id: Int!): Boolean!
    upsertLodgingServiceItem(
      id: Int
      kind: String!
      name: String!
      unitPriceETB: Float!
      unitLabel: String
      isActive: Boolean
    ): LodgingServiceItem!
    deleteLodgingServiceItem(id: Int!): Boolean!

    upsertLodgingGuest(
      id: Int
      firstName: String!
      lastName: String!
      sex: String
      phone: String!
      phoneSecondary: String
      email: String
      isEthiopian: Boolean
      nationalId: String
      passportNumber: String
      country: String
      stateRegion: String
      addressLine: String
    ): LodgingGuest!
    createLodgingStay(
      guestId: Int
      guestJson: JSON
      arrivalAt: DateTime!
      nights: Int!
      adults: Int
      children: Int
      preferredRoomType: String
      roomIds: [Int!]!
      notes: String
      status: String
    ): LodgingStay!
    updateLodgingStay(
      id: Int!
      arrivalAt: DateTime
      departureAt: DateTime
      nights: Int
      adults: Int
      children: Int
      preferredRoomType: String
      notes: String
      status: String
      guestId: Int
    ): LodgingStay!
    addLodgingBillLine(
      stayId: Int!
      kind: String!
      description: String!
      quantity: Float!
      unitPriceETB: Float!
      roomNumber: String
    ): LodgingBillLine!
    updateLodgingBillLine(lineId: Int!, quantity: Float!): LodgingBillLine!
    deleteLodgingBillLine(lineId: Int!): Boolean!
    transferLodgingBillLines(lineIds: [Int!]!, toStayId: Int!): LodgingBill!
    splitLodgingBillLine(
      lineId: Int!
      quantityToMove: Float!
      toStayId: Int!
    ): LodgingBill!
    checkoutLodgingStay(stayId: Int!, departureAt: DateTime!): LodgingStay!
    registerLodgingServiceCharge(
      stayId: Int!
      serviceItemId: Int!
      quantity: Float!
      roomNumber: String
    ): LodgingBillLine!

    updateLodgingRoomStatus(
      roomId: Int!
      status: String!
      maintenanceUntil: DateTime
      notes: String
    ): LodgingRoom!
    createLodgingCmAssignment(
      roomId: Int!
      workKind: String!
      assigneeName: String!
      notes: String
    ): LodgingCmAssignment!
    completeLodgingCmAssignment(id: Int!): LodgingCmAssignment!
`;

export async function logLodgingAction(
  prisma,
  {
    HotelName,
    actorRole,
    actorName,
    action,
    entityType,
    entityId,
    stayId,
    detail,
  },
) {
  await prisma.lodging_action_log.create({
    data: {
      HotelName,
      actorRole: actorRole != null ? String(actorRole) : "",
      actorName: actorName != null ? String(actorName) : "",
      action: String(action),
      entityType: entityType != null ? String(entityType) : "",
      entityId: entityId != null ? Number(entityId) : null,
      stayId: stayId != null ? Number(stayId) : null,
      detailJson:
        detail == null
          ? ""
          : typeof detail === "string"
            ? detail
            : JSON.stringify(detail),
    },
  });
}

function actorFromContext(context) {
  const u = context?.user;
  return {
    actorRole: String(u?.Role ?? u?.role ?? ""),
    actorName: String(u?.UserName ?? u?.userName ?? ""),
  };
}

function requireTenant(context, tenantScopeFromContext) {
  const HotelName = tenantScopeFromContext(context);
  if (!HotelName) throw new Error("Tenant scope missing");
  return HotelName;
}

function pad4(n) {
  return String(n).padStart(4, "0");
}

function ymd(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function generateVoucherCode(prisma, HotelName, arrivalAt) {
  const prefix = `VCH-${ymd(arrivalAt)}-`;
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = `${prefix}${pad4(Math.floor(Math.random() * 10000))}`;
    const existing = await prisma.lodging_stay.findFirst({
      where: { HotelName, voucherCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error("Could not allocate unique voucher code");
}

function addDays(date, nights) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(nights));
  return d;
}

function parseGuestPayload(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Invalid guestJson");
    }
  }
  if (typeof raw === "object") return raw;
  throw new Error("Invalid guestJson");
}

function guestDataFromInput(input, HotelName) {
  const phone = String(input.phone ?? "").trim();
  if (!phone) throw new Error("Guest phone is required");
  const firstName = String(input.firstName ?? "").trim();
  const lastName = String(input.lastName ?? "").trim();
  if (!firstName || !lastName) throw new Error("Guest name is required");
  return {
    HotelName,
    firstName,
    lastName,
    sex: String(input.sex ?? "").trim(),
    phone,
    phoneSecondary: String(input.phoneSecondary ?? "").trim(),
    email: String(input.email ?? "").trim(),
    isEthiopian:
      input.isEthiopian == null ? true : Boolean(input.isEthiopian),
    nationalId: String(input.nationalId ?? "").trim(),
    passportNumber: String(input.passportNumber ?? "").trim(),
    country: String(input.country ?? "Ethiopia").trim() || "Ethiopia",
    stateRegion: String(input.stateRegion ?? "").trim(),
    addressLine: String(input.addressLine ?? "").trim(),
  };
}

async function recalcBillTotal(prisma, billId) {
  const lines = await prisma.lodging_bill_line.findMany({
    where: { billId },
    select: { amountETB: true },
  });
  const totalETB = lines.reduce((s, l) => s + Number(l.amountETB || 0), 0);
  return prisma.lodging_bill.update({
    where: { id: billId },
    data: { totalETB },
    include: { lines: { orderBy: { id: "asc" } } },
  });
}

async function loadStayOrThrow(
  prisma,
  context,
  stayId,
  tenantHotelReadMatches,
) {
  const stay = await prisma.lodging_stay.findUnique({
    where: { id: Number(stayId) },
    include: STAY_INCLUDE,
  });
  if (!stay || !tenantHotelReadMatches(context, stay.HotelName)) {
    throw new Error("Stay not found");
  }
  return stay;
}

async function loadRoomOrThrow(
  prisma,
  context,
  roomId,
  tenantHotelReadMatches,
) {
  const room = await prisma.lodging_room.findUnique({
    where: { id: Number(roomId) },
  });
  if (!room || !tenantHotelReadMatches(context, room.HotelName)) {
    throw new Error("Room not found");
  }
  return room;
}

/**
 * @param {{
 *   prisma: import("@prisma/client").PrismaClient,
 *   tenantScopeFromContext: Function,
 *   tenantHotelReadWhere: Function,
 *   tenantHotelReadMatches: Function,
 *   assertRole: Function,
 *   assertAdminOrManager: Function,
 *   assertAuthenticated: Function,
 * }} deps
 */
export function createLodgingResolvers({
  prisma,
  tenantScopeFromContext,
  tenantHotelReadWhere,
  tenantHotelReadMatches,
  assertRole,
  assertAdminOrManager,
  assertAuthenticated,
}) {
  const assertReceptionOrManager = (context) =>
    assertRole(context, ["Reception", "Manager", "Admin"]);

  const assertCmPortal = (context) =>
    assertRole(context, ["CMLeader", "Reception", "Manager", "Admin"]);

  const assertLodgingRead = (context) =>
    assertRole(context, [
      "Reception",
      "CMLeader",
      "Manager",
      "Admin",
    ]);

  return {
    Query: {
      lodgingRooms: async (_, __, context) => {
        assertLodgingRead(context);
        return prisma.lodging_room.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: [{ floor: "asc" }, { roomNumber: "asc" }],
        });
      },

      lodgingRoomsByStatus: async (_, { status }, context) => {
        assertLodgingRead(context);
        const s = String(status || "").trim();
        if (!ROOM_STATUSES.has(s)) throw new Error("Invalid room status");
        return prisma.lodging_room.findMany({
          where: { ...tenantHotelReadWhere(context), status: s },
          orderBy: [{ floor: "asc" }, { roomNumber: "asc" }],
        });
      },

      lodgingCmQueue: async (_, __, context) => {
        assertCmPortal(context);
        return prisma.lodging_room.findMany({
          where: {
            ...tenantHotelReadWhere(context),
            status: { in: ["vacant_dirty", "on_maintenance"] },
          },
          orderBy: [{ status: "asc" }, { roomNumber: "asc" }],
        });
      },

      lodgingGuests: async (_, { search }, context) => {
        assertReceptionOrManager(context);
        const q = String(search ?? "").trim();
        const base = tenantHotelReadWhere(context);
        if (!q) {
          return prisma.lodging_guest.findMany({
            where: base,
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
            take: 200,
          });
        }
        return prisma.lodging_guest.findMany({
          where: {
            AND: [
              base,
              {
                OR: [
                  { phone: { contains: q } },
                  { phoneSecondary: { contains: q } },
                  { firstName: { contains: q } },
                  { lastName: { contains: q } },
                  { nationalId: { contains: q } },
                  { passportNumber: { contains: q } },
                  { email: { contains: q } },
                ],
              },
            ],
          },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 100,
        });
      },

      lodgingGuest: async (_, { id }, context) => {
        assertReceptionOrManager(context);
        const guest = await prisma.lodging_guest.findUnique({
          where: { id: Number(id) },
        });
        if (!guest || !tenantHotelReadMatches(context, guest.HotelName)) {
          return null;
        }
        return guest;
      },

      lodgingActiveStays: async (_, __, context) => {
        assertReceptionOrManager(context);
        return prisma.lodging_stay.findMany({
          where: {
            ...tenantHotelReadWhere(context),
            status: { in: ["checked_in", "reserved"] },
          },
          include: STAY_INCLUDE,
          orderBy: { arrivalAt: "desc" },
        });
      },

      lodgingStay: async (_, { id }, context) => {
        assertReceptionOrManager(context);
        const stay = await prisma.lodging_stay.findUnique({
          where: { id: Number(id) },
          include: STAY_INCLUDE,
        });
        if (!stay || !tenantHotelReadMatches(context, stay.HotelName)) {
          return null;
        }
        return stay;
      },

      lodgingStaysByDate: async (_, { from, to }, context) => {
        assertReceptionOrManager(context);
        const fromDt = new Date(from);
        const toDt = new Date(to);
        if (Number.isNaN(fromDt.getTime()) || Number.isNaN(toDt.getTime())) {
          throw new Error("Invalid date range");
        }
        return prisma.lodging_stay.findMany({
          where: {
            ...tenantHotelReadWhere(context),
            arrivalAt: { gte: fromDt, lte: toDt },
          },
          include: STAY_INCLUDE,
          orderBy: { arrivalAt: "asc" },
        });
      },

      lodgingServiceItems: async (_, { kind }, context) => {
        assertLodgingRead(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (kind != null && String(kind).trim() !== "") {
          const k = String(kind).trim();
          if (!SERVICE_KINDS.has(k)) throw new Error("Invalid service kind");
          where.kind = k;
        }
        return prisma.lodging_service_item.findMany({
          where,
          orderBy: [{ kind: "asc" }, { name: "asc" }],
        });
      },

      lodgingCmAssignments: async (_, { status }, context) => {
        assertCmPortal(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (status != null && String(status).trim() !== "") {
          const s = String(status).trim();
          if (!CM_STATUSES.has(s)) throw new Error("Invalid CM status");
          where.status = s;
        }
        return prisma.lodging_cm_assignment.findMany({
          where,
          include: { room: true },
          orderBy: { createdAt: "desc" },
        });
      },

      lodgingActionLogs: async (_, { limit, stayId }, context) => {
        assertRole(context, ["Manager", "Admin", "Reception", "CMLeader"]);
        const take = Math.min(Math.max(Number(limit) || 50, 1), 500);
        const where = { ...tenantHotelReadWhere(context) };
        if (stayId != null) where.stayId = Number(stayId);
        // Reception only sees their own actions; managers/CM see the full trail.
        const { actorName, actorRole } = actorFromContext(context);
        if (actorRole === "Reception" && actorName) {
          where.actorName = actorName;
        }
        return prisma.lodging_action_log.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take,
        });
      },

      lodgingDashboardStats: async (_, __, context) => {
        assertLodgingRead(context);
        const scope = tenantHotelReadWhere(context);
        const [
          vacantClean,
          vacantDirty,
          occupied,
          onMaintenance,
          activeStays,
          openCmAssignments,
        ] = await Promise.all([
          prisma.lodging_room.count({
            where: { ...scope, status: "vacant_clean" },
          }),
          prisma.lodging_room.count({
            where: { ...scope, status: "vacant_dirty" },
          }),
          prisma.lodging_room.count({
            where: { ...scope, status: "occupied" },
          }),
          prisma.lodging_room.count({
            where: { ...scope, status: "on_maintenance" },
          }),
          prisma.lodging_stay.count({
            where: {
              ...scope,
              status: { in: ["checked_in", "reserved"] },
            },
          }),
          prisma.lodging_cm_assignment.count({
            where: { ...scope, status: "open" },
          }),
        ]);
        return {
          vacantClean,
          vacantDirty,
          occupied,
          onMaintenance,
          activeStays,
          openCmAssignments,
        };
      },
    },

    Mutation: {
      createLodgingRoom: async (
        _,
        { roomNumber, roomType, floor, pricePerNightETB, notes },
        context,
      ) => {
        assertAdminOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName, actorRole } = actorFromContext(context);
        const rn = String(roomNumber).trim();
        if (!rn) throw new Error("Room number is required");
        const room = await prisma.lodging_room.create({
          data: {
            HotelName,
            roomNumber: rn,
            roomType: String(roomType).trim(),
            floor: String(floor ?? "").trim(),
            pricePerNightETB: Number(pricePerNightETB) || 0,
            status: "vacant_clean",
            notes: String(notes ?? "").trim(),
            createdBy: actorName,
            updatedBy: actorName,
          },
        });
        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "create_room",
          entityType: "lodging_room",
          entityId: room.id,
          detail: { roomNumber: room.roomNumber },
        });
        return room;
      },

      updateLodgingRoom: async (
        _,
        {
          id,
          roomNumber,
          roomType,
          floor,
          pricePerNightETB,
          notes,
          status,
          maintenanceUntil,
        },
        context,
      ) => {
        assertAdminOrManager(context);
        const room = await loadRoomOrThrow(
          prisma,
          context,
          id,
          tenantHotelReadMatches,
        );
        const { actorName, actorRole } = actorFromContext(context);
        const data = { updatedBy: actorName };
        if (roomNumber != null) {
          const rn = String(roomNumber).trim();
          if (!rn) throw new Error("Room number is required");
          data.roomNumber = rn;
        }
        if (roomType != null) data.roomType = String(roomType).trim();
        if (floor != null) data.floor = String(floor).trim();
        if (pricePerNightETB != null)
          data.pricePerNightETB = Number(pricePerNightETB) || 0;
        if (notes != null) data.notes = String(notes).trim();
        if (status != null) {
          const s = String(status).trim();
          if (!ROOM_STATUSES.has(s)) throw new Error("Invalid room status");
          data.status = s;
          if (s !== "on_maintenance") data.maintenanceUntil = null;
        }
        if (maintenanceUntil !== undefined) {
          data.maintenanceUntil =
            maintenanceUntil == null ? null : new Date(maintenanceUntil);
        }
        const updated = await prisma.lodging_room.update({
          where: { id: room.id },
          data,
        });
        await logLodgingAction(prisma, {
          HotelName: room.HotelName,
          actorRole,
          actorName,
          action: "update_room",
          entityType: "lodging_room",
          entityId: room.id,
          detail: data,
        });
        return updated;
      },

      deleteLodgingRoom: async (_, { id }, context) => {
        assertAdminOrManager(context);
        const room = await loadRoomOrThrow(
          prisma,
          context,
          id,
          tenantHotelReadMatches,
        );
        if (room.status === "occupied") {
          throw new Error("Cannot delete an occupied room");
        }
        const activeLink = await prisma.lodging_stay_room.findFirst({
          where: {
            roomId: room.id,
            stay: { status: { in: ["reserved", "checked_in"] } },
          },
        });
        if (activeLink) {
          throw new Error("Cannot delete a room linked to an active stay");
        }
        const { actorName, actorRole } = actorFromContext(context);
        await prisma.lodging_room.delete({ where: { id: room.id } });
        await logLodgingAction(prisma, {
          HotelName: room.HotelName,
          actorRole,
          actorName,
          action: "delete_room",
          entityType: "lodging_room",
          entityId: room.id,
          detail: { roomNumber: room.roomNumber },
        });
        return true;
      },

      upsertLodgingServiceItem: async (
        _,
        { id, kind, name, unitPriceETB, unitLabel, isActive },
        context,
      ) => {
        assertAdminOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const k = String(kind).trim();
        if (!SERVICE_KINDS.has(k)) throw new Error("Invalid service kind");
        const itemName = String(name).trim();
        if (!itemName) throw new Error("Service name is required");
        const { actorName, actorRole } = actorFromContext(context);
        const payload = {
          kind: k,
          name: itemName,
          unitPriceETB: Number(unitPriceETB) || 0,
          unitLabel: String(unitLabel ?? "pcs").trim() || "pcs",
          isActive: isActive == null ? true : Boolean(isActive),
        };

        let item;
        if (id != null) {
          const existing = await prisma.lodging_service_item.findUnique({
            where: { id: Number(id) },
          });
          if (
            !existing ||
            !tenantHotelReadMatches(context, existing.HotelName)
          ) {
            throw new Error("Service item not found");
          }
          item = await prisma.lodging_service_item.update({
            where: { id: existing.id },
            data: payload,
          });
        } else {
          item = await prisma.lodging_service_item.upsert({
            where: {
              HotelName_kind_name: {
                HotelName,
                kind: k,
                name: itemName,
              },
            },
            create: { HotelName, ...payload },
            update: payload,
          });
        }

        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "upsert_service_item",
          entityType: "lodging_service_item",
          entityId: item.id,
          detail: payload,
        });
        return item;
      },

      deleteLodgingServiceItem: async (_, { id }, context) => {
        assertAdminOrManager(context);
        const item = await prisma.lodging_service_item.findUnique({
          where: { id: Number(id) },
        });
        if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
          throw new Error("Service item not found");
        }
        const { actorName, actorRole } = actorFromContext(context);
        await prisma.lodging_service_item.delete({ where: { id: item.id } });
        await logLodgingAction(prisma, {
          HotelName: item.HotelName,
          actorRole,
          actorName,
          action: "delete_service_item",
          entityType: "lodging_service_item",
          entityId: item.id,
          detail: { name: item.name, kind: item.kind },
        });
        return true;
      },

      upsertLodgingGuest: async (_, args, context) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const data = guestDataFromInput(args, HotelName);
        const { actorName, actorRole } = actorFromContext(context);

        let guest;
        if (args.id != null) {
          const existing = await prisma.lodging_guest.findUnique({
            where: { id: Number(args.id) },
          });
          if (
            !existing ||
            !tenantHotelReadMatches(context, existing.HotelName)
          ) {
            throw new Error("Guest not found");
          }
          guest = await prisma.lodging_guest.update({
            where: { id: existing.id },
            data,
          });
        } else {
          const byPhone = await prisma.lodging_guest.findFirst({
            where: { HotelName, phone: data.phone },
          });
          if (byPhone) {
            guest = await prisma.lodging_guest.update({
              where: { id: byPhone.id },
              data,
            });
          } else {
            guest = await prisma.lodging_guest.create({ data });
          }
        }

        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "upsert_guest",
          entityType: "lodging_guest",
          entityId: guest.id,
          detail: { phone: guest.phone, name: `${guest.firstName} ${guest.lastName}` },
        });
        return guest;
      },

      createLodgingStay: async (
        _,
        {
          guestId,
          guestJson,
          arrivalAt,
          nights,
          adults,
          children,
          preferredRoomType,
          roomIds,
          notes,
          status,
        },
        context,
      ) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName, actorRole } = actorFromContext(context);

        const nightsN = Math.max(1, Number(nights) || 1);
        const arrival = new Date(arrivalAt);
        if (Number.isNaN(arrival.getTime())) throw new Error("Invalid arrivalAt");
        const departureAt = addDays(arrival, nightsN);

        let stayStatus = String(status ?? "checked_in").trim();
        if (stayStatus !== "reserved" && stayStatus !== "checked_in") {
          throw new Error("Stay status must be reserved or checked_in");
        }

        const ids = Array.isArray(roomIds)
          ? [...new Set(roomIds.map((x) => Number(x)).filter((n) => n > 0))]
          : [];
        if (ids.length === 0) throw new Error("At least one room is required");

        const rooms = await prisma.lodging_room.findMany({
          where: { id: { in: ids }, ...tenantHotelReadWhere(context) },
        });
        if (rooms.length !== ids.length) {
          throw new Error("One or more rooms not found");
        }
        for (const r of rooms) {
          if (r.status !== "vacant_clean") {
            throw new Error(
              `Room ${r.roomNumber} must be vacant and clean to assign (current: ${r.status})`,
            );
          }
        }

        let guest;
        if (guestId != null) {
          guest = await prisma.lodging_guest.findUnique({
            where: { id: Number(guestId) },
          });
          if (!guest || !tenantHotelReadMatches(context, guest.HotelName)) {
            throw new Error("Guest not found");
          }
        } else {
          const payload = parseGuestPayload(guestJson);
          if (!payload) throw new Error("guestId or guestJson is required");
          const gData = guestDataFromInput(payload, HotelName);
          if (payload.id != null) {
            const existing = await prisma.lodging_guest.findUnique({
              where: { id: Number(payload.id) },
            });
            if (
              !existing ||
              !tenantHotelReadMatches(context, existing.HotelName)
            ) {
              throw new Error("Guest not found");
            }
            guest = await prisma.lodging_guest.update({
              where: { id: existing.id },
              data: gData,
            });
          } else {
            const byPhone = await prisma.lodging_guest.findFirst({
              where: { HotelName, phone: gData.phone },
            });
            guest = byPhone
              ? await prisma.lodging_guest.update({
                  where: { id: byPhone.id },
                  data: gData,
                })
              : await prisma.lodging_guest.create({ data: gData });
          }
        }

        const voucherCode = await generateVoucherCode(
          prisma,
          HotelName,
          arrival,
        );

        const stay = await prisma.$transaction(async (tx) => {
          const created = await tx.lodging_stay.create({
            data: {
              HotelName,
              voucherCode,
              guestId: guest.id,
              status: stayStatus,
              arrivalAt: arrival,
              departureAt,
              nights: nightsN,
              adults: Math.max(1, Number(adults) || 1),
              children: Math.max(0, Number(children) || 0),
              preferredRoomType: String(preferredRoomType ?? "").trim(),
              notes: String(notes ?? "").trim(),
              checkedInBy: stayStatus === "checked_in" ? actorName : "",
            },
          });

          for (const r of rooms) {
            await tx.lodging_stay_room.create({
              data: {
                stayId: created.id,
                roomId: r.id,
                roomType: r.roomType,
              },
            });
            await tx.lodging_room.update({
              where: { id: r.id },
              data: {
                status: "occupied",
                maintenanceUntil: null,
                updatedBy: actorName,
              },
            });
          }

          const bill = await tx.lodging_bill.create({
            data: {
              HotelName,
              stayId: created.id,
              status: "open",
              totalETB: 0,
            },
          });

          let total = 0;
          for (const r of rooms) {
            const unit = Number(r.pricePerNightETB) || 0;
            const amount = unit * nightsN;
            total += amount;
            await tx.lodging_bill_line.create({
              data: {
                billId: bill.id,
                kind: "room",
                description: `Room ${r.roomNumber} × ${nightsN} night(s)`,
                quantity: nightsN,
                unitPriceETB: unit,
                amountETB: amount,
                roomNumber: r.roomNumber,
                createdBy: actorName,
              },
            });
          }

          await tx.lodging_bill.update({
            where: { id: bill.id },
            data: { totalETB: total },
          });

          return created;
        });

        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "create_stay",
          entityType: "lodging_stay",
          entityId: stay.id,
          stayId: stay.id,
          detail: {
            voucherCode,
            roomIds: ids,
            status: stayStatus,
            nights: nightsN,
          },
        });

        return prisma.lodging_stay.findUnique({
          where: { id: stay.id },
          include: STAY_INCLUDE,
        });
      },

      updateLodgingStay: async (
        _,
        {
          id,
          arrivalAt,
          departureAt,
          nights,
          adults,
          children,
          preferredRoomType,
          notes,
          status,
          guestId,
        },
        context,
      ) => {
        assertReceptionOrManager(context);
        const stay = await loadStayOrThrow(
          prisma,
          context,
          id,
          tenantHotelReadMatches,
        );
        if (stay.status === "checked_out" || stay.status === "cancelled") {
          throw new Error("Cannot edit a closed stay");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const data = {};

        if (guestId != null) {
          const guest = await prisma.lodging_guest.findUnique({
            where: { id: Number(guestId) },
          });
          if (!guest || !tenantHotelReadMatches(context, guest.HotelName)) {
            throw new Error("Guest not found");
          }
          data.guestId = guest.id;
        }
        if (arrivalAt != null) {
          const a = new Date(arrivalAt);
          if (Number.isNaN(a.getTime())) throw new Error("Invalid arrivalAt");
          data.arrivalAt = a;
        }
        if (nights != null) {
          data.nights = Math.max(1, Number(nights) || 1);
        }
        if (departureAt != null) {
          const d = new Date(departureAt);
          if (Number.isNaN(d.getTime())) throw new Error("Invalid departureAt");
          data.departureAt = d;
        } else if (data.arrivalAt || data.nights) {
          const arr = data.arrivalAt || stay.arrivalAt;
          const n = data.nights != null ? data.nights : stay.nights;
          data.departureAt = addDays(arr, n);
        }
        if (adults != null) data.adults = Math.max(1, Number(adults) || 1);
        if (children != null)
          data.children = Math.max(0, Number(children) || 0);
        if (preferredRoomType != null)
          data.preferredRoomType = String(preferredRoomType).trim();
        if (notes != null) data.notes = String(notes).trim();
        if (status != null) {
          const s = String(status).trim();
          if (!STAY_STATUSES.has(s)) throw new Error("Invalid stay status");
          if (s === "checked_out") {
            throw new Error("Use checkoutLodgingStay to check out");
          }
          data.status = s;
          if (s === "checked_in" && !stay.checkedInBy) {
            data.checkedInBy = actorName;
          }
        }

        const updated = await prisma.lodging_stay.update({
          where: { id: stay.id },
          data,
          include: STAY_INCLUDE,
        });

        await logLodgingAction(prisma, {
          HotelName: stay.HotelName,
          actorRole,
          actorName,
          action: "update_stay",
          entityType: "lodging_stay",
          entityId: stay.id,
          stayId: stay.id,
          detail: data,
        });
        return updated;
      },

      addLodgingBillLine: async (
        _,
        { stayId, kind, description, quantity, unitPriceETB, roomNumber },
        context,
      ) => {
        assertReceptionOrManager(context);
        const stay = await loadStayOrThrow(
          prisma,
          context,
          stayId,
          tenantHotelReadMatches,
        );
        if (stay.status === "checked_out" || stay.status === "cancelled") {
          throw new Error("Stay is closed");
        }
        let bill = stay.bill;
        if (!bill) {
          bill = await prisma.lodging_bill.create({
            data: {
              HotelName: stay.HotelName,
              stayId: stay.id,
              status: "open",
              totalETB: 0,
            },
            include: { lines: true },
          });
        }
        if (bill.status !== "open") throw new Error("Bill is not open");

        const k = String(kind).trim();
        if (!BILL_LINE_KINDS.has(k)) throw new Error("Invalid bill line kind");
        const qty = Number(quantity);
        const unit = Number(unitPriceETB);
        if (!(qty > 0)) throw new Error("Quantity must be positive");
        if (!(unit >= 0)) throw new Error("Invalid unit price");
        const { actorName, actorRole } = actorFromContext(context);

        const line = await prisma.lodging_bill_line.create({
          data: {
            billId: bill.id,
            kind: k,
            description: String(description).trim(),
            quantity: qty,
            unitPriceETB: unit,
            amountETB: qty * unit,
            roomNumber: String(roomNumber ?? "").trim(),
            createdBy: actorName,
          },
        });
        await recalcBillTotal(prisma, bill.id);
        await logLodgingAction(prisma, {
          HotelName: stay.HotelName,
          actorRole,
          actorName,
          action: "add_bill_line",
          entityType: "lodging_bill_line",
          entityId: line.id,
          stayId: stay.id,
          detail: { kind: k, amountETB: line.amountETB },
        });
        return line;
      },

      updateLodgingBillLine: async (_, { lineId, quantity }, context) => {
        assertReceptionOrManager(context);
        const line = await prisma.lodging_bill_line.findUnique({
          where: { id: Number(lineId) },
          include: { bill: { include: { stay: true } } },
        });
        if (!line?.bill?.stay) throw new Error("Bill line not found");
        if (!tenantHotelReadMatches(context, line.bill.stay.HotelName)) {
          throw new Error("Bill line not found");
        }
        if (line.bill.status !== "open") throw new Error("Bill is not open");
        if (
          line.bill.stay.status === "checked_out" ||
          line.bill.stay.status === "cancelled"
        ) {
          throw new Error("Stay is closed");
        }
        const qty = Number(quantity);
        if (!(qty > 0)) throw new Error("Quantity must be positive");
        const { actorName, actorRole } = actorFromContext(context);
        const unit = Number(line.unitPriceETB) || 0;
        const updated = await prisma.lodging_bill_line.update({
          where: { id: line.id },
          data: {
            quantity: qty,
            amountETB: qty * unit,
          },
        });
        await recalcBillTotal(prisma, line.billId);
        await logLodgingAction(prisma, {
          HotelName: line.bill.stay.HotelName,
          actorRole,
          actorName,
          action: "update_bill_line",
          entityType: "lodging_bill_line",
          entityId: line.id,
          stayId: line.bill.stay.id,
          detail: { quantity: qty },
        });
        return updated;
      },

      deleteLodgingBillLine: async (_, { lineId }, context) => {
        assertReceptionOrManager(context);
        const line = await prisma.lodging_bill_line.findUnique({
          where: { id: Number(lineId) },
          include: { bill: { include: { stay: true } } },
        });
        if (!line?.bill?.stay) throw new Error("Bill line not found");
        if (!tenantHotelReadMatches(context, line.bill.stay.HotelName)) {
          throw new Error("Bill line not found");
        }
        if (line.bill.status !== "open") throw new Error("Bill is not open");
        if (
          line.bill.stay.status === "checked_out" ||
          line.bill.stay.status === "cancelled"
        ) {
          throw new Error("Stay is closed");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const billId = line.billId;
        const stayId = line.bill.stay.id;
        const HotelName = line.bill.stay.HotelName;
        await prisma.lodging_bill_line.delete({ where: { id: line.id } });
        await recalcBillTotal(prisma, billId);
        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "delete_bill_line",
          entityType: "lodging_bill_line",
          entityId: line.id,
          stayId,
          detail: { description: line.description },
        });
        return true;
      },

      transferLodgingBillLines: async (_, { lineIds, toStayId }, context) => {
        assertReceptionOrManager(context);
        const ids = Array.isArray(lineIds)
          ? [...new Set(lineIds.map((x) => Number(x)).filter((n) => n > 0))]
          : [];
        if (ids.length === 0) throw new Error("No lines to transfer");

        const toStay = await loadStayOrThrow(
          prisma,
          context,
          toStayId,
          tenantHotelReadMatches,
        );
        if (toStay.status === "checked_out" || toStay.status === "cancelled") {
          throw new Error("Target stay is closed");
        }

        let toBill = toStay.bill;
        if (!toBill) {
          toBill = await prisma.lodging_bill.create({
            data: {
              HotelName: toStay.HotelName,
              stayId: toStay.id,
              status: "open",
              totalETB: 0,
            },
          });
        }
        if (toBill.status !== "open") throw new Error("Target bill is not open");

        const lines = await prisma.lodging_bill_line.findMany({
          where: { id: { in: ids } },
          include: { bill: true },
        });
        if (lines.length !== ids.length) throw new Error("One or more lines not found");

        const fromBillIds = new Set();
        for (const line of lines) {
          if (
            !tenantHotelReadMatches(context, line.bill.HotelName) ||
            line.bill.HotelName !== toStay.HotelName
          ) {
            throw new Error("Line not in tenant");
          }
          if (line.bill.status !== "open") {
            throw new Error("Source bill is not open");
          }
          if (line.billId === toBill.id) {
            throw new Error("Line already on target bill");
          }
          fromBillIds.add(line.billId);
        }

        const { actorName, actorRole } = actorFromContext(context);
        await prisma.$transaction(async (tx) => {
          await tx.lodging_bill_line.updateMany({
            where: { id: { in: ids } },
            data: { billId: toBill.id },
          });
        });

        for (const bid of fromBillIds) {
          await recalcBillTotal(prisma, bid);
        }
        const updated = await recalcBillTotal(prisma, toBill.id);

        await logLodgingAction(prisma, {
          HotelName: toStay.HotelName,
          actorRole,
          actorName,
          action: "transfer_bill_lines",
          entityType: "lodging_bill",
          entityId: toBill.id,
          stayId: toStay.id,
          detail: { lineIds: ids, fromBillIds: [...fromBillIds] },
        });
        return updated;
      },

      splitLodgingBillLine: async (
        _,
        { lineId, quantityToMove, toStayId },
        context,
      ) => {
        assertReceptionOrManager(context);
        const qtyMove = Number(quantityToMove);
        if (!(qtyMove > 0)) throw new Error("quantityToMove must be positive");

        const line = await prisma.lodging_bill_line.findUnique({
          where: { id: Number(lineId) },
          include: { bill: true },
        });
        if (!line || !tenantHotelReadMatches(context, line.bill.HotelName)) {
          throw new Error("Bill line not found");
        }
        if (line.bill.status !== "open") throw new Error("Source bill is not open");
        if (qtyMove >= Number(line.quantity)) {
          throw new Error("quantityToMove must be less than line quantity");
        }

        const toStay = await loadStayOrThrow(
          prisma,
          context,
          toStayId,
          tenantHotelReadMatches,
        );
        if (toStay.HotelName !== line.bill.HotelName) {
          throw new Error("Target stay must be same hotel");
        }
        if (toStay.status === "checked_out" || toStay.status === "cancelled") {
          throw new Error("Target stay is closed");
        }

        let toBill = toStay.bill;
        if (!toBill) {
          toBill = await prisma.lodging_bill.create({
            data: {
              HotelName: toStay.HotelName,
              stayId: toStay.id,
              status: "open",
              totalETB: 0,
            },
          });
        }
        if (toBill.status !== "open") throw new Error("Target bill is not open");
        if (toBill.id === line.billId) {
          throw new Error("Cannot split onto the same bill");
        }

        const { actorName, actorRole } = actorFromContext(context);
        const unit = Number(line.unitPriceETB) || 0;
        const remainQty = Number(line.quantity) - qtyMove;

        await prisma.$transaction(async (tx) => {
          await tx.lodging_bill_line.update({
            where: { id: line.id },
            data: {
              quantity: remainQty,
              amountETB: remainQty * unit,
            },
          });
          await tx.lodging_bill_line.create({
            data: {
              billId: toBill.id,
              kind: line.kind,
              description: line.description,
              quantity: qtyMove,
              unitPriceETB: unit,
              amountETB: qtyMove * unit,
              roomNumber: line.roomNumber,
              createdBy: actorName,
            },
          });
        });

        await recalcBillTotal(prisma, line.billId);
        const updated = await recalcBillTotal(prisma, toBill.id);

        await logLodgingAction(prisma, {
          HotelName: toStay.HotelName,
          actorRole,
          actorName,
          action: "split_bill_line",
          entityType: "lodging_bill_line",
          entityId: line.id,
          stayId: toStay.id,
          detail: { quantityToMove: qtyMove, toStayId: toStay.id },
        });
        return updated;
      },

      checkoutLodgingStay: async (_, { stayId, departureAt }, context) => {
        assertReceptionOrManager(context);
        const stay = await loadStayOrThrow(
          prisma,
          context,
          stayId,
          tenantHotelReadMatches,
        );
        if (stay.status === "checked_out") {
          throw new Error("Stay already checked out");
        }
        if (stay.status === "cancelled") {
          throw new Error("Stay is cancelled");
        }
        const dep = new Date(departureAt);
        if (Number.isNaN(dep.getTime())) throw new Error("Invalid departureAt");

        const { actorName, actorRole } = actorFromContext(context);
        const receiptNumber = `RCP-${ymd(dep)}-${pad4(stay.id % 10000)}`;

        await prisma.$transaction(async (tx) => {
          if (stay.bill && stay.bill.status === "open") {
            await tx.lodging_bill.update({
              where: { id: stay.bill.id },
              data: {
                status: "settled",
                settledAt: new Date(),
                settledBy: actorName,
                receiptNumber,
              },
            });
          }

          await tx.lodging_stay.update({
            where: { id: stay.id },
            data: {
              status: "checked_out",
              departureAt: dep,
              checkedOutBy: actorName,
            },
          });

          for (const sr of stay.rooms || []) {
            await tx.lodging_room.update({
              where: { id: sr.roomId },
              data: {
                status: "vacant_dirty",
                updatedBy: actorName,
              },
            });
          }
        });

        await logLodgingAction(prisma, {
          HotelName: stay.HotelName,
          actorRole,
          actorName,
          action: "checkout_stay",
          entityType: "lodging_stay",
          entityId: stay.id,
          stayId: stay.id,
          detail: { departureAt: dep.toISOString(), receiptNumber },
        });

        return prisma.lodging_stay.findUnique({
          where: { id: stay.id },
          include: STAY_INCLUDE,
        });
      },

      registerLodgingServiceCharge: async (
        _,
        { stayId, serviceItemId, quantity, roomNumber },
        context,
      ) => {
        assertReceptionOrManager(context);
        const stay = await loadStayOrThrow(
          prisma,
          context,
          stayId,
          tenantHotelReadMatches,
        );
        if (stay.status === "checked_out" || stay.status === "cancelled") {
          throw new Error("Stay is closed");
        }
        const item = await prisma.lodging_service_item.findUnique({
          where: { id: Number(serviceItemId) },
        });
        if (
          !item ||
          !tenantHotelReadMatches(context, item.HotelName) ||
          item.HotelName !== stay.HotelName
        ) {
          throw new Error("Service item not found");
        }
        if (!item.isActive) throw new Error("Service item is inactive");

        let bill = stay.bill;
        if (!bill) {
          bill = await prisma.lodging_bill.create({
            data: {
              HotelName: stay.HotelName,
              stayId: stay.id,
              status: "open",
              totalETB: 0,
            },
          });
        }
        if (bill.status !== "open") throw new Error("Bill is not open");

        const qty = Number(quantity);
        if (!(qty > 0)) throw new Error("Quantity must be positive");
        const unit = Number(item.unitPriceETB) || 0;
        const { actorName, actorRole } = actorFromContext(context);

        const line = await prisma.lodging_bill_line.create({
          data: {
            billId: bill.id,
            kind: item.kind,
            description: `${item.name} (${item.unitLabel})`,
            quantity: qty,
            unitPriceETB: unit,
            amountETB: qty * unit,
            roomNumber: String(roomNumber ?? "").trim(),
            createdBy: actorName,
          },
        });
        await recalcBillTotal(prisma, bill.id);
        await logLodgingAction(prisma, {
          HotelName: stay.HotelName,
          actorRole,
          actorName,
          action: "register_service_charge",
          entityType: "lodging_bill_line",
          entityId: line.id,
          stayId: stay.id,
          detail: { serviceItemId: item.id, quantity: qty },
        });
        return line;
      },

      updateLodgingRoomStatus: async (
        _,
        { roomId, status, maintenanceUntil, notes },
        context,
      ) => {
        assertCmPortal(context);
        const room = await loadRoomOrThrow(
          prisma,
          context,
          roomId,
          tenantHotelReadMatches,
        );
        const s = String(status).trim();
        if (!ROOM_STATUSES.has(s)) throw new Error("Invalid room status");

        const role = String(
          context.user?.Role ?? context.user?.role ?? "",
        )
          .trim()
          .toLowerCase();
        const isElevated =
          role === "manager" || role === "admin" || role === "reception";
        if (!isElevated) {
          // CMLeader: only vacant_clean from dirty/maintenance, or set/update maintenance
          if (s === "vacant_clean") {
            if (
              room.status !== "vacant_dirty" &&
              room.status !== "on_maintenance"
            ) {
              throw new Error(
                "CM may only set vacant_clean from vacant_dirty or on_maintenance",
              );
            }
          } else if (s !== "on_maintenance") {
            throw new Error("CM may only set vacant_clean or on_maintenance");
          }
        }

        const { actorName, actorRole } = actorFromContext(context);
        const data = {
          status: s,
          updatedBy: actorName,
        };
        if (notes != null) data.notes = String(notes).trim();
        if (s === "on_maintenance") {
          data.maintenanceUntil =
            maintenanceUntil != null
              ? new Date(maintenanceUntil)
              : room.maintenanceUntil;
        } else {
          data.maintenanceUntil = null;
        }

        const updated = await prisma.lodging_room.update({
          where: { id: room.id },
          data,
        });
        await logLodgingAction(prisma, {
          HotelName: room.HotelName,
          actorRole,
          actorName,
          action: "update_room_status",
          entityType: "lodging_room",
          entityId: room.id,
          detail: { from: room.status, to: s },
        });
        return updated;
      },

      createLodgingCmAssignment: async (
        _,
        { roomId, workKind, assigneeName, notes },
        context,
      ) => {
        assertCmPortal(context);
        const room = await loadRoomOrThrow(
          prisma,
          context,
          roomId,
          tenantHotelReadMatches,
        );
        const wk = String(workKind).trim();
        if (!CM_WORK_KINDS.has(wk)) throw new Error("Invalid workKind");
        const assignee = String(assigneeName ?? "").trim();
        if (!assignee) throw new Error("assigneeName is required");
        const { actorName, actorRole } = actorFromContext(context);

        const row = await prisma.lodging_cm_assignment.create({
          data: {
            HotelName: room.HotelName,
            roomId: room.id,
            workKind: wk,
            assigneeName: assignee,
            notes: String(notes ?? "").trim(),
            status: "open",
            assignedBy: actorName,
          },
          include: { room: true },
        });

        if (wk === "maintenance" && room.status !== "occupied") {
          await prisma.lodging_room.update({
            where: { id: room.id },
            data: { status: "on_maintenance", updatedBy: actorName },
          });
        }

        await logLodgingAction(prisma, {
          HotelName: room.HotelName,
          actorRole,
          actorName,
          action: "create_cm_assignment",
          entityType: "lodging_cm_assignment",
          entityId: row.id,
          detail: { roomId: room.id, workKind: wk, assigneeName: assignee },
        });

        return prisma.lodging_cm_assignment.findUnique({
          where: { id: row.id },
          include: { room: true },
        });
      },

      completeLodgingCmAssignment: async (_, { id }, context) => {
        assertCmPortal(context);
        const row = await prisma.lodging_cm_assignment.findUnique({
          where: { id: Number(id) },
          include: { room: true },
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("CM assignment not found");
        }
        if (row.status !== "open") {
          throw new Error("Assignment is not open");
        }
        const { actorName, actorRole } = actorFromContext(context);

        await prisma.$transaction(async (tx) => {
          await tx.lodging_cm_assignment.update({
            where: { id: row.id },
            data: {
              status: "done",
              completedBy: actorName,
              completedAt: new Date(),
            },
          });
          if (
            row.workKind === "cleaning" &&
            (row.room.status === "vacant_dirty" ||
              row.room.status === "on_maintenance")
          ) {
            await tx.lodging_room.update({
              where: { id: row.roomId },
              data: {
                status: "vacant_clean",
                maintenanceUntil: null,
                updatedBy: actorName,
              },
            });
          }
        });

        await logLodgingAction(prisma, {
          HotelName: row.HotelName,
          actorRole,
          actorName,
          action: "complete_cm_assignment",
          entityType: "lodging_cm_assignment",
          entityId: row.id,
          detail: { workKind: row.workKind, roomId: row.roomId },
        });

        return prisma.lodging_cm_assignment.findUnique({
          where: { id: row.id },
          include: { room: true },
        });
      },
    },
  };
}
