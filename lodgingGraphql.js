/**
 * Lodging — Room Management + Cleaning & Maintenance GraphQL API.
 * Wired into BackEnd/index.js (types + Query/Mutation fields + resolvers).
 */

import { issueUniqueGuestOtp, clearGuestOtp } from "./lib/guestOtp.js";
import bcrypt from "bcryptjs";

const ROOM_STATUSES = new Set([
  "vacant_dirty",
  "occupied",
  "vacant_clean",
  "on_maintenance",
  "reserved",
  "inspected",
  "out_of_order",
  "out_of_service",
  "blocked",
]);

const MANAGER_ONLY_ROOM_STATUSES = new Set([
  "out_of_order",
  "out_of_service",
  "blocked",
]);

const RESERVATION_STATUSES = new Set([
  "tentative",
  "confirmed",
  "cancelled",
  "no_show",
  "checked_in",
]);

const RESERVATION_SOURCES = new Set([
  "walk_in",
  "phone",
  "website",
  "agency",
  "corporate",
  "other",
]);
const STAY_STATUSES = new Set([
  "reserved",
  "checked_in",
  "checked_out",
  "cancelled",
]);
const BILL_STATUSES = new Set(["open", "settled", "void"]);
const BILL_LINE_KINDS = new Set([
  "room",
  "food_drink",
  "laundry",
  "other",
  "penalty",
]);
const RATE_PLAN_KINDS = new Set([
  "standard",
  "corporate",
  "seasonal",
  "weekend",
  "promo",
  "long_stay",
  "group",
  "event",
]);
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
    bedType: String!
    capacity: Int!
    amenities: String!
    imageUrl: String!
    status: String!
    maintenanceUntil: DateTime
    statusExpectedEndAt: DateTime
    notes: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    createdBy: String!
    updatedBy: String!
  }

  type LodgingDateFit {
    ok: Boolean!
    message: String!
    maxNights: Int
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
    lastCheckedInAt: DateTime
    lastCheckedOutAt: DateTime
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
    taxPercent: Float!
    taxETB: Float!
    taxDetailJson: String!
    roomNumber: String!
    # pending | completed | cancelled
    fulfillmentStatus: String!
    fulfilledAt: DateTime
    fulfilledBy: String!
    voided: Boolean!
    voidedAt: DateTime
    voidedBy: String!
    voidReason: String!
    # "" | pending | approved | rejected (discounts)
    approvalStatus: String!
    approvedBy: String!
    approvedAt: DateTime
    approvalNote: String!
    createdAt: DateTime!
    createdBy: String!
  }

  type LodgingBill {
    id: Int!
    HotelName: String!
    stayId: Int!
    status: String!
    totalETB: Float!
    cashETB: Float!
    bankETB: Float!
    telebirrETB: Float!
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
    reservationId: Int
    status: String!
    arrivalAt: DateTime!
    reservedArrivalAt: DateTime
    departureAt: DateTime!
    expectedNights: Int!
    expectedDepartureAt: DateTime
    nights: Int!
    adults: Int!
    children: Int!
    preferredRoomType: String!
    ratePlanId: Int
    ratePlanName: String!
    isCompany: Boolean!
    companyName: String!
    companyTin: String!
    notes: String!
    checkedInBy: String!
    checkedOutBy: String!
    # Guest room portal code (6 digits). Issued at check-in for reception to share with guest.
    guestOtp: String
    guestOtpIssuedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    guest: LodgingGuest!
    rooms: [LodgingStayRoom!]!
    bill: LodgingBill
  }

  type LodgingReservationRoom {
    id: Int!
    reservationId: Int!
    roomId: Int
    roomType: String!
    createdAt: DateTime!
    room: LodgingRoom
  }

  type LodgingReservation {
    id: Int!
    HotelName: String!
    reservationCode: String!
    guestId: Int
    status: String!
    source: String!
    arrivalAt: DateTime!
    departureAt: DateTime!
    nights: Int!
    adults: Int!
    children: Int!
    preferredRoomType: String!
    depositETB: Float!
    depositPaymentMethod: String!
    isCompany: Boolean!
    companyName: String!
    companyTin: String!
    notes: String!
    createdBy: String!
    updatedBy: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    guest: LodgingGuest
    rooms: [LodgingReservationRoom!]!
  }

  type LodgingTaxConfig {
    id: Int!
    HotelName: String!
    name: String!
    kind: String!
    taxPercent: Float!
    updatedBy: String!
    updatedAt: DateTime!
    createdAt: DateTime!
  }

  type LodgingBusinessDay {
    id: Int!
    HotelName: String!
    businessDate: String!
    label: String!
    fromAt: DateTime!
    toAt: DateTime!
    status: String!
    closedAt: DateTime
    closedBy: String!
    receptionistId: Int
    receptionistName: String!
    summaryJson: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type LodgingReceptionist {
    id: Int!
    HotelName: String!
    firstName: String!
    lastName: String!
    isActive: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
    updatedBy: String!
  }

  type LodgingRatePlan {
    id: Int!
    HotelName: String!
    name: String!
    code: String!
    kind: String!
    roomType: String!
    pricePerNightETB: Float!
    startDate: String!
    endDate: String!
    minNights: Int!
    priority: Int!
    isActive: Boolean!
    notes: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    updatedBy: String!
  }

  type LodgingPerformanceReport {
    fromDate: String!
    toDate: String!
    roomNightsSold: Int!
    availableRoomNights: Int!
    occupancyPercent: Float!
    roomRevenueETB: Float!
    adrETB: Float!
    revparETB: Float!
    staysCheckedOut: Int!
    staysInHouse: Int!
    byRoomType: [LodgingPerformanceByType!]!
    bySource: [LodgingPerformanceBySource!]!
  }

  type LodgingPerformanceByType {
    roomType: String!
    roomNightsSold: Int!
    roomRevenueETB: Float!
    adrETB: Float!
  }

  type LodgingPerformanceBySource {
    source: String!
    stays: Int!
    roomRevenueETB: Float!
  }

  type LodgingGuestComplaint {
    id: Int!
    HotelName: String!
    stayId: Int!
    guestId: Int
    roomId: Int
    roomNumber: String!
    category: String!
    message: String!
    status: String!
    isCritical: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
    guestName: String!
    voucherCode: String!
    roomNumbers: String!
  }

  type LodgingGuestRating {
    id: Int!
    HotelName: String!
    stayId: Int!
    guestId: Int
    overall: Int!
    cleanliness: Int
    service: Int
    comment: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    guestName: String!
    voucherCode: String!
    roomNumbers: String!
  }

  type LodgingServiceItem {
    id: Int!
    HotelName: String!
    kind: String!
    name: String!
    unitPriceETB: Float!
    unitLabel: String!
    imageUrl: String!
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
    reserved: Int!
    inspected: Int!
    outOfOrder: Int!
    outOfService: Int!
    blocked: Int!
    activeStays: Int!
    openCmAssignments: Int!
    todayCheckIns: Int!
    todayCheckOuts: Int!
    openReservations: Int!
    occupancyPercent: Float!
    outstandingBalanceETB: Float!
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
    lodgingHoldableRooms(
      arrivalAt: DateTime!
      nights: Int
      excludeReservationId: Int
    ): [LodgingRoom!]!
    """Explain whether a room fits arrival+nights with the one-day cleaning gap rule."""
    lodgingRoomDateFit(
      roomId: Int!
      arrivalAt: DateTime!
      nights: Int!
      excludeReservationId: Int
    ): LodgingDateFit!
    lodgingGuests(search: String): [LodgingGuest!]!
    lodgingGuest(id: Int!): LodgingGuest
    lodgingActiveStays: [LodgingStay!]!
    lodgingStay(id: Int!): LodgingStay
    lodgingStaysByDate(from: DateTime!, to: DateTime!): [LodgingStay!]!
    """Guests whose stay overlaps [from, to] — for Manager police/security PDF."""
    lodgingPoliceGuestReport(from: DateTime!, to: DateTime!): [LodgingStay!]!
    lodgingSearch(query: String!): [LodgingStay!]!
    lodgingServiceItems(kind: String): [LodgingServiceItem!]!
    lodgingCmAssignments(status: String): [LodgingCmAssignment!]!
    lodgingActionLogs(limit: Int, stayId: Int): [LodgingActionLog!]!
    lodgingDashboardStats: LodgingDashboardStats!
    lodgingReservations(status: String, from: DateTime, to: DateTime): [LodgingReservation!]!
    lodgingReservation(id: Int!): LodgingReservation
    lodgingTaxConfigs: [LodgingTaxConfig!]!
    pendingLodgingDiscounts: [LodgingBillLine!]!
    lodgingRatePlans(activeOnly: Boolean): [LodgingRatePlan!]!
    lodgingPerformanceReport(fromDate: String!, toDate: String!): LodgingPerformanceReport!
    lodgingBusinessDay(businessDate: String): LodgingBusinessDay
    lodgingBusinessDays(limit: Int): [LodgingBusinessDay!]!
    lodgingReceptionists(includeInactive: Boolean): [LodgingReceptionist!]!
    lodgingGuestComplaints(status: String, limit: Int): [LodgingGuestComplaint!]!
    lodgingGuestComplaintHistory(guestId: Int!, limit: Int): [LodgingGuestComplaint!]!
    lodgingGuestRatings(limit: Int): [LodgingGuestRating!]!
    lodgingGuestRatingHistory(guestId: Int!, limit: Int): [LodgingGuestRating!]!
`;

export const lodgingMutationFields = `
    createLodgingRoom(
      roomNumber: String!
      roomType: String!
      floor: String
      pricePerNightETB: Float!
      bedType: String
      capacity: Int
      amenities: String
      imageUrl: String
      notes: String
    ): LodgingRoom!
    updateLodgingRoom(
      id: Int!
      roomNumber: String
      roomType: String
      floor: String
      pricePerNightETB: Float
      bedType: String
      capacity: Int
      amenities: String
      imageUrl: String
      notes: String
      status: String
      maintenanceUntil: DateTime
      statusExpectedEndAt: DateTime
    ): LodgingRoom!
    deleteLodgingRoom(id: Int!): Boolean!
    upsertLodgingServiceItem(
      id: Int
      kind: String!
      name: String!
      unitPriceETB: Float!
      unitLabel: String
      imageUrl: String
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
      reservationId: Int
      ratePlanId: Int
      isCompany: Boolean
      companyName: String
      companyTin: String
    ): LodgingStay!
    updateLodgingStay(
      id: Int!
      arrivalAt: DateTime
      departureAt: DateTime
      nights: Int
      expectedNights: Int
      expectedDepartureAt: DateTime
      adults: Int
      children: Int
      preferredRoomType: String
      notes: String
      status: String
      guestId: Int
    ): LodgingStay!
    transferLodgingStayRoom(
      stayId: Int!
      fromRoomId: Int!
      toRoomId: Int!
      reason: String
      markOldOnMaintenance: Boolean
      maintenanceUntil: DateTime
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
    voidLodgingBillLine(lineId: Int!, reason: String!): LodgingBillLine!
    # Manager-only: void entire open bill.
    voidLodgingBill(billId: Int!, reason: String!): LodgingBill!
    # Manager-only: void all open charges for a room number on a stay.
    voidLodgingRoomCharges(
      stayId: Int!
      roomNumber: String!
      reason: String!
    ): LodgingStay!
    # Reception requests; Manager/Admin applies immediately as approved.
    requestLodgingDiscount(
      stayId: Int!
      amountETB: Float!
      reason: String!
    ): LodgingBillLine!
    # Manager/Admin: approve or reject a pending discount line.
    resolveLodgingDiscount(
      lineId: Int!
      approve: Boolean!
      note: String
    ): LodgingBillLine!
    # Reception/Manager: mark laundry fulfillment. Use completed | cancelled | pending.
    setLodgingBillLineFulfillment(lineId: Int!, status: String!): LodgingBillLine!
    transferLodgingBillLines(lineIds: [Int!]!, toStayId: Int!): LodgingBill!
    splitLodgingBillLine(
      lineId: Int!
      quantityToMove: Float!
      toStayId: Int!
    ): LodgingBill!
    checkoutLodgingStay(
      stayId: Int!
      departureAt: DateTime!
      nights: Int
      cashETB: Float
      bankETB: Float
      telebirrETB: Float
    ): LodgingStay!
    # Issue or re-issue guest portal OTP for a checked-in stay (e.g. guest forgot).
    issueLodgingGuestOtp(stayId: Int!): LodgingStay!
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
      statusExpectedEndAt: DateTime
      notes: String
    ): LodgingRoom!
    """Hold a vacant room as complimentary staff housing (not for sale). Manager only."""
    assignLodgingComplimentRoom(
      roomId: Int!
      assigneeName: String!
      note: String
    ): LodgingRoom!
    """Update assignee / note on an existing complimentary staff room."""
    updateLodgingComplimentRoom(
      roomId: Int!
      assigneeName: String!
      note: String
    ): LodgingRoom!
    """Release a complimentary staff room back to inventory."""
    releaseLodgingComplimentRoom(roomId: Int!): LodgingRoom!
    createLodgingCmAssignments(
      roomId: Int!
      workKind: String!
      assigneeNames: [String!]!
      notes: String
      statusExpectedEndAt: DateTime
    ): [LodgingCmAssignment!]!
    updateLodgingCmAssignment(
      id: Int!
      assigneeName: String
      notes: String
      statusExpectedEndAt: DateTime
    ): LodgingCmAssignment!
    """
    Sync open assignees for a room's in-progress cleaning or maintenance job:
    add missing names, cancel removed ones, update notes / expected ready.
    At least one assignee must remain.
    """
    syncLodgingCmOpenAssignees(
      roomId: Int!
      workKind: String!
      assigneeNames: [String!]!
      notes: String
      statusExpectedEndAt: DateTime
    ): [LodgingCmAssignment!]!
    completeLodgingCmAssignment(id: Int!): LodgingCmAssignment!

    createLodgingReservation(
      guestId: Int
      guestJson: JSON
      source: String!
      status: String
      arrivalAt: DateTime!
      nights: Int!
      adults: Int
      children: Int
      preferredRoomType: String
      roomIds: [Int!]
      depositETB: Float
      depositPaymentMethod: String
      isCompany: Boolean
      companyName: String
      companyTin: String
      notes: String
    ): LodgingReservation!
    updateLodgingReservation(
      id: Int!
      status: String
      source: String
      arrivalAt: DateTime
      nights: Int
      adults: Int
      children: Int
      preferredRoomType: String
      roomIds: [Int!]
      depositETB: Float
      depositPaymentMethod: String
      isCompany: Boolean
      companyName: String
      companyTin: String
      notes: String
      guestId: Int
    ): LodgingReservation!
    cancelLodgingReservation(id: Int!, asNoShow: Boolean): LodgingReservation!
    checkInLodgingReservation(
      reservationId: Int!
      roomIds: [Int!]!
      arrivalAt: DateTime
      notes: String
    ): LodgingStay!

    upsertLodgingTaxConfig(
      kind: String!
      name: String!
      taxPercent: Float!
      id: Int
    ): LodgingTaxConfig!
    deleteLodgingTaxConfig(id: Int!): Boolean!
    """Batch guest penalty charges on an open stay — no Manager approval."""
    addLodgingPenaltyLines(
      stayId: Int!
      linesJson: String!
      note: String
    ): LodgingStay!
    closeLodgingBusinessDay(
      businessDate: String
      fromAt: DateTime!
      toAt: DateTime!
      label: String
      id: Int
      receptionistId: Int
    ): LodgingBusinessDay!
    openLodgingBusinessDay(
      fromAt: DateTime!
      toAt: DateTime!
      label: String
      businessDate: String
    ): LodgingBusinessDay!
    """Batch-create named receptionists (shared Reception username, unique passwords)."""
    createLodgingReceptionists(linesJson: String!): [LodgingReceptionist!]!
    updateLodgingReceptionist(
      id: Int!
      firstName: String
      lastName: String
      password: String
      isActive: Boolean
    ): LodgingReceptionist!
    deleteLodgingReceptionist(id: Int!): Boolean!
    createLodgingRatePlan(
      name: String!
      code: String
      kind: String!
      roomType: String
      pricePerNightETB: Float!
      startDate: String
      endDate: String
      minNights: Int
      priority: Int
      isActive: Boolean
      notes: String
    ): LodgingRatePlan!
    updateLodgingRatePlan(
      id: Int!
      name: String
      code: String
      kind: String
      roomType: String
      pricePerNightETB: Float
      startDate: String
      endDate: String
      minNights: Int
      priority: Int
      isActive: Boolean
      notes: String
    ): LodgingRatePlan!
    deleteLodgingRatePlan(id: Int!): Boolean!
    updateLodgingGuestComplaint(
      id: Int!
      status: String!
    ): LodgingGuestComplaint!
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
  const receptionistName = String(u?.receptionistName ?? "").trim();
  const receptionistIdRaw = u?.receptionistId;
  const receptionistId =
    receptionistIdRaw != null && Number.isFinite(Number(receptionistIdRaw))
      ? Number(receptionistIdRaw)
      : null;
  return {
    actorRole: String(u?.Role ?? u?.role ?? ""),
    actorName:
      receptionistName || String(u?.UserName ?? u?.userName ?? ""),
    receptionistId,
    receptionistName,
  };
}

function receptionistDisplayName(row) {
  return `${row.firstName || ""} ${row.lastName || ""}`.trim();
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

/** Cafe tableNo offset — must match frontend `lib/lodgingRoomService.ts`. */
export const ROOM_SERVICE_TABLE_BASE = 900_000;

export function stayIdFromRoomServiceTableNo(tableNo) {
  const n = Math.floor(Number(tableNo) || 0);
  if (n < ROOM_SERVICE_TABLE_BASE) return null;
  return n - ROOM_SERVICE_TABLE_BASE;
}

export function isRoomServiceTableNo(tableNo) {
  const n = Math.floor(Number(tableNo) || 0);
  return Number.isFinite(n) && n >= ROOM_SERVICE_TABLE_BASE;
}

/** Calendar-date night count (departure date − arrival date), minimum 1. */
export function nightsFromArrivalDeparture(arrival, departure) {
  const a = new Date(arrival);
  const d = new Date(departure);
  if (Number.isNaN(a.getTime()) || Number.isNaN(d.getTime())) return 1;
  const a0 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const d0 = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((d0 - a0) / (24 * 60 * 60 * 1000));
  return Math.max(1, days);
}

export function cafeOrderIdFromBillDescription(description) {
  const m = String(description || "").match(/#co:(\d+)\s*$/i);
  return m ? Number(m[1]) : null;
}

function withCafeOrderMarker(description, orderId) {
  const base = String(description || "")
    .replace(/\s*·\s*#co:\d+\s*$/i, "")
    .trim();
  return `${base} · #co:${orderId}`;
}

function roomServiceCaptionFromStay(stay) {
  const rooms = (stay.rooms || [])
    .map((sr) => sr.room?.roomNumber)
    .filter(Boolean)
    .join(", ");
  return rooms ? `Room ${rooms}` : "Room service";
}

/** Move a café ticket onto the destination stay's room-service table. */
async function reassignCafeOrderToStay(db, orderId, toStay) {
  const id = Number(orderId);
  if (!(id > 0) || !toStay) return null;
  const order = await db.order.findUnique({ where: { id } });
  if (!order) return null;
  if (String(order.HotelName) !== String(toStay.HotelName)) return null;
  if (String(order.status || "").toLowerCase() === "cancelled") return null;
  const tableNo = ROOM_SERVICE_TABLE_BASE + toStay.id;
  return db.order.update({
    where: { id },
    data: {
      tableNo,
      serviceCaption: roomServiceCaptionFromStay(toStay),
    },
  });
}

/**
 * After a qty split of a food_drink line: shrink source café order and create
 * a new ticket on the destination stay for the moved qty.
 */
async function splitCafeOrderForBillLine(
  db,
  { sourceOrderId, remainQty, moveQty, toStay, actorName },
) {
  const order = await db.order.findUnique({
    where: { id: Number(sourceOrderId) },
  });
  if (!order) return null;
  if (String(order.status || "").toLowerCase() === "cancelled") return null;

  const remain = Math.max(1, Math.round(Number(remainQty)));
  const move = Math.max(1, Math.round(Number(moveQty)));

  await db.order.update({
    where: { id: order.id },
    data: { orderAmount: remain },
  });

  return db.order.create({
    data: {
      title: order.title,
      imageUrl: order.imageUrl || "",
      tableNo: ROOM_SERVICE_TABLE_BASE + toStay.id,
      category: order.category,
      type: order.type,
      orderAmount: move,
      HotelName: order.HotelName,
      price: order.price,
      // Keep frozen ingredient cost so profit reports stay accurate after splits.
      unitCostAtSale:
        order.unitCostAtSale != null &&
        Number.isFinite(Number(order.unitCostAtSale))
          ? Number(order.unitCostAtSale)
          : null,
      waiterName: order.waiterName || actorName || "Reception",
      status: order.status || "Pending",
      payment: order.payment || "Unpaid",
      withBank: order.withBank ?? false,
      credit: false,
      serviceCaption: roomServiceCaptionFromStay(toStay),
    },
  });
}

/** Food & drink bill lines require café Order status Completed for transfer/split/checkout.
 * Cancelled café orders are ignored and never block these actions.
 */
async function assertFoodDrinkLinesCompleted(prisma, lines, HotelName) {
  const foodLines = (lines || []).filter((l) => {
    if (String(l.kind || "").toLowerCase() !== "food_drink") return false;
    // Voided folio lines (e.g. whole-bill void) must not block checkout.
    if (l.voided) return false;
    return true;
  });
  if (foodLines.length === 0) return;

  const orderIds = [
    ...new Set(
      foodLines
        .map((l) => cafeOrderIdFromBillDescription(l.description))
        .filter((id) => id != null && id > 0),
    ),
  ];

  const byId = new Map();
  if (orderIds.length > 0) {
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds }, HotelName },
    });
    for (const o of orders) byId.set(o.id, o);
  }

  for (const line of foodLines) {
    if (String(line.fulfillmentStatus || "").toLowerCase() === "cancelled") {
      continue;
    }
    if (String(line.fulfillmentStatus || "").toLowerCase() === "completed") {
      continue;
    }
    const oid = cafeOrderIdFromBillDescription(line.description);
    let order = oid != null ? byId.get(oid) : null;
    if (!order && oid == null) {
      const title = String(line.description || "")
        .replace(/\s*·\s*#co:\d+\s*$/i, "")
        .split(" · ")[0]
        .trim()
        .toLowerCase();
      if (title) {
        const candidates = await prisma.order.findMany({
          where: {
            HotelName,
            tableNo: { gte: ROOM_SERVICE_TABLE_BASE },
          },
          take: 80,
        });
        order =
          candidates.find((o) => {
            const status = String(o.status || "").toLowerCase();
            if (status === "cancelled") return false;
            return String(o.title || "").toLowerCase() === title;
          }) || null;
      }
    }
    // No linked ticket, or cancelled — do not block transfer/split/checkout.
    if (!order) continue;
    const status = String(order.status || "").toLowerCase();
    if (status === "cancelled") continue;
    if (status !== "completed") {
      throw new Error(
        `Food & drink "${order.title}" is ${order.status || "Pending"} — wait until Completed`,
      );
    }
  }
}

/** Laundry lines must be completed (or cancelled) before checkout. */
async function assertLaundryLinesCompleted(lines) {
  for (const line of lines || []) {
    if (String(line.kind || "").toLowerCase() !== "laundry") continue;
    if (line.voided) continue;
    const st = String(line.fulfillmentStatus || "pending").toLowerCase();
    if (st === "cancelled" || st === "completed") continue;
    const label = String(line.description || "Laundry").split(" · ")[0].trim();
    throw new Error(
      `Laundry "${label}" is still pending — reception must mark it completed before checkout`,
    );
  }
}

function ymdLocal(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function planMatchesWeekend(kind, arrivalAt) {
  if (String(kind).toLowerCase() !== "weekend") return true;
  const d = arrivalAt instanceof Date ? arrivalAt : new Date(arrivalAt);
  const day = d.getDay(); // 0 Sun … 5 Fri 6 Sat
  return day === 5 || day === 6 || day === 0;
}

/**
 * Pick the best active rate plan for a room type / arrival / nights.
 * Returns null to fall back to the room's rack pricePerNightETB.
 */
async function resolveRatePlan(
  prisma,
  HotelName,
  roomType,
  arrivalAt,
  nightsN,
  forcedPlanId = null,
) {
  if (forcedPlanId != null && Number(forcedPlanId) > 0) {
    const forced = await prisma.lodging_rate_plan.findFirst({
      where: {
        id: Number(forcedPlanId),
        HotelName,
        isActive: true,
      },
    });
    if (forced) return forced;
  }
  const arrivalDay = ymdLocal(arrivalAt);
  const nights = Math.max(1, Number(nightsN) || 1);
  const plans = await prisma.lodging_rate_plan.findMany({
    where: { HotelName, isActive: true },
    orderBy: [{ priority: "desc" }, { id: "desc" }],
  });
  for (const p of plans) {
    if (Number(p.minNights || 1) > nights) continue;
    const rt = String(p.roomType || "").trim();
    if (rt && rt !== String(roomType || "").trim()) continue;
    const start = String(p.startDate || "").trim();
    const end = String(p.endDate || "").trim();
    if (start && arrivalDay && arrivalDay < start) continue;
    if (end && arrivalDay && arrivalDay > end) continue;
    if (!planMatchesWeekend(p.kind, arrivalAt)) continue;
    return p;
  }
  return null;
}

async function unitPriceForRoomNight(
  prisma,
  HotelName,
  room,
  arrivalAt,
  nightsN,
  stayRatePlanId = null,
) {
  const plan = await resolveRatePlan(
    prisma,
    HotelName,
    room.roomType,
    arrivalAt,
    nightsN,
    stayRatePlanId,
  );
  if (plan) {
    return {
      unit: Number(plan.pricePerNightETB) || 0,
      ratePlanId: plan.id,
      ratePlanName: plan.name,
    };
  }
  return {
    unit: Number(room.pricePerNightETB) || 0,
    ratePlanId: null,
    ratePlanName: "",
  };
}

async function syncRoomNightCharges(db, stay, nightsN, actorName) {
  if (!stay.bill || stay.bill.status !== "open") return;
  const billId = stay.bill.id;
  const n = Math.max(1, Number(nightsN) || 1);
  await db.lodging_bill_line.deleteMany({
    where: { billId, kind: "room" },
  });
  let frozenPlanId = stay.ratePlanId ?? null;
  let frozenPlanName = stay.ratePlanName || "";
  for (const sr of stay.rooms || []) {
    const r = sr.room;
    if (!r) continue;
    const priced = await unitPriceForRoomNight(
      db,
      stay.HotelName,
      r,
      stay.arrivalAt,
      n,
      frozenPlanId,
    );
    if (!frozenPlanId && priced.ratePlanId) {
      frozenPlanId = priced.ratePlanId;
      frozenPlanName = priced.ratePlanName;
    }
    const unit = priced.unit;
    const amount = unit * n;
    const planLabel = priced.ratePlanName
      ? ` · ${priced.ratePlanName}`
      : "";
    await db.lodging_bill_line.create({
      data: {
        billId,
        kind: "room",
        description: `Room ${r.roomNumber} × ${n} night(s)${planLabel}`,
        quantity: n,
        unitPriceETB: unit,
        amountETB: amount,
        roomNumber: r.roomNumber,
        createdBy: actorName,
      },
    });
  }
  if (frozenPlanId && !stay.ratePlanId) {
    await db.lodging_stay.update({
      where: { id: stay.id },
      data: {
        ratePlanId: frozenPlanId,
        ratePlanName: frozenPlanName,
      },
    });
  }
  await recalcBillTotal(db, billId);
}

/**
 * Drop food_drink stay bill line(s) for a cancelled room-service café order.
 */
export async function removeRoomServiceOrderFromLodgingBill(prisma, order) {
  if (!order || !isRoomServiceTableNo(order.tableNo)) return false;
  const stayId = stayIdFromRoomServiceTableNo(order.tableNo);
  if (!stayId) return false;
  const stay = await prisma.lodging_stay.findUnique({
    where: { id: stayId },
    include: {
      bill: { include: { lines: { orderBy: { id: "asc" } } } },
    },
  });
  if (!stay?.bill || stay.bill.status !== "open") return false;

  const oid = Number(order.id);
  const title = String(order.title || "")
    .trim()
    .toLowerCase();
  const qty = Number(order.orderAmount) || 0;
  const price = Number(order.price) || 0;

  let match =
    stay.bill.lines.find(
      (l) =>
        l.kind === "food_drink" &&
        cafeOrderIdFromBillDescription(l.description) === oid,
    ) || null;

  if (!match && title) {
    const candidates = stay.bill.lines.filter((l) => {
      if (l.kind !== "food_drink") return false;
      if (cafeOrderIdFromBillDescription(l.description) != null) return false;
      const desc = String(l.description || "")
        .toLowerCase()
        .trim();
      return (
        desc === title ||
        desc.startsWith(`${title} ·`) ||
        desc.includes(title)
      );
    });
    match =
      candidates.find(
        (l) =>
          Number(l.quantity) === qty &&
          Math.abs(Number(l.unitPriceETB) - price) < 0.011,
      ) ||
      candidates[candidates.length - 1] ||
      null;
  }

  if (!match) return false;
  await prisma.lodging_bill_line.update({
    where: { id: match.id },
    data: {
      fulfillmentStatus: "cancelled",
      fulfilledAt: new Date(),
      fulfilledBy: String(order.cancelledBy || "Kitchen/Bar").trim(),
      amountETB: 0,
      // Keep cancelled café tickets off the open folio / transfer selection.
      voided: true,
      voidedAt: new Date(),
      voidedBy: String(order.cancelledBy || "Kitchen/Bar").trim(),
      voidReason: "Order cancelled",
    },
  });
  await recalcBillTotal(prisma, stay.bill.id);
  return true;
}

/**
 * When a room-service café ticket is edited (room/stay via tableNo, and/or qty),
 * keep the matching lodging food_drink bill line on Active stays in sync.
 */
export async function syncLodgingBillForRoomServiceOrderUpdate(
  prisma,
  {
    orderId,
    prevTableNo,
    nextTableNo,
    nextOrderAmount,
    HotelName,
  },
) {
  const oid = Number(orderId);
  if (!(oid > 0)) return false;

  const prevStayId = isRoomServiceTableNo(prevTableNo)
    ? stayIdFromRoomServiceTableNo(prevTableNo)
    : null;
  const nextStayId = isRoomServiceTableNo(nextTableNo)
    ? stayIdFromRoomServiceTableNo(nextTableNo)
    : null;

  const hotel = String(HotelName || "").trim();
  const marker = `#co:${oid}`;

  let line = null;
  if (hotel) {
    const marked = await prisma.lodging_bill_line.findMany({
      where: {
        kind: "food_drink",
        description: { contains: marker },
        bill: { status: "open", HotelName: hotel },
      },
      include: { bill: true },
    });
    line =
      marked.find(
        (l) => cafeOrderIdFromBillDescription(l.description) === oid,
      ) || null;
  }

  if (!line && prevStayId != null) {
    const stay = await prisma.lodging_stay.findUnique({
      where: { id: prevStayId },
      include: {
        bill: { include: { lines: { orderBy: { id: "asc" } } } },
      },
    });
    if (stay?.bill?.status === "open") {
      line =
        stay.bill.lines.find(
          (l) =>
            l.kind === "food_drink" &&
            cafeOrderIdFromBillDescription(l.description) === oid,
        ) || null;
      if (line) {
        line = await prisma.lodging_bill_line.findUnique({
          where: { id: line.id },
          include: { bill: true },
        });
      }
    }
  }

  if (!line?.bill || line.bill.status !== "open") return false;

  // Moved off room-service onto a floor table — drop stay charge.
  if (nextStayId == null) {
    const billId = line.billId;
    await prisma.lodging_bill_line.delete({ where: { id: line.id } });
    await recalcBillTotal(prisma, billId);
    return true;
  }

  const toStay = await prisma.lodging_stay.findUnique({
    where: { id: nextStayId },
    include: {
      bill: true,
      rooms: { include: { room: true } },
    },
  });
  if (!toStay) throw new Error("Target stay not found for this room");
  if (toStay.status === "checked_out" || toStay.status === "cancelled") {
    throw new Error("Target stay is closed");
  }
  if (hotel && String(toStay.HotelName) !== hotel) {
    throw new Error("Target stay is not in this property");
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

  const roomNumber = (toStay.rooms || [])
    .map((sr) => sr.room?.roomNumber)
    .filter(Boolean)
    .join(", ");

  const data = {
    roomNumber: roomNumber || String(line.roomNumber || ""),
  };
  if (nextOrderAmount != null) {
    const qty = Math.max(1, Math.floor(Number(nextOrderAmount)));
    const unit = Number(line.unitPriceETB) || 0;
    data.quantity = qty;
    data.amountETB = qty * unit;
  }
  if (line.billId !== toBill.id) {
    data.billId = toBill.id;
  }

  const fromBillId = line.billId;
  await prisma.lodging_bill_line.update({
    where: { id: line.id },
    data,
  });
  if (fromBillId !== toBill.id) {
    await recalcBillTotal(prisma, fromBillId);
  }
  await recalcBillTotal(prisma, toBill.id);
  return true;
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

/** Attach latest check-in / check-out timestamps from stays onto guest rows. */
async function withGuestStayDates(prisma, guests) {
  const list = Array.isArray(guests) ? guests : guests ? [guests] : [];
  if (list.length === 0) return guests;
  const ids = [...new Set(list.map((g) => Number(g.id)).filter((id) => id > 0))];
  if (ids.length === 0) {
    return Array.isArray(guests)
      ? guests.map((g) => ({ ...g, lastCheckedInAt: null, lastCheckedOutAt: null }))
      : { ...guests, lastCheckedInAt: null, lastCheckedOutAt: null };
  }

  const stays = await prisma.lodging_stay.findMany({
    where: { guestId: { in: ids } },
    select: {
      guestId: true,
      arrivalAt: true,
      departureAt: true,
      status: true,
    },
    orderBy: { arrivalAt: "desc" },
  });

  const lastInByGuest = new Map();
  const lastOutByGuest = new Map();
  for (const s of stays) {
    if (!lastInByGuest.has(s.guestId)) {
      lastInByGuest.set(s.guestId, s.arrivalAt);
    }
    if (
      String(s.status || "").toLowerCase() === "checked_out" &&
      !lastOutByGuest.has(s.guestId)
    ) {
      lastOutByGuest.set(s.guestId, s.departureAt);
    }
  }

  const enrich = (g) => ({
    ...g,
    lastCheckedInAt: lastInByGuest.get(g.id) ?? null,
    lastCheckedOutAt: lastOutByGuest.get(g.id) ?? null,
  });

  return Array.isArray(guests) ? guests.map(enrich) : enrich(guests);
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

function enrichGuestFeedbackRow(row, criticalGuestIds = null, criticalRoomKeys = null) {
  const guest = row.guest || row.stay?.guest || null;
  const guestName = guest
    ? `${guest.firstName || ""} ${guest.lastName || ""}`.trim() || "Guest"
    : "Guest";
  const rooms = (row.stay?.rooms || [])
    .map((sr) => sr.room?.roomNumber)
    .filter(Boolean);
  const roomNumber =
    String(row.roomNumber || "").trim() || rooms[0] || "";
  let isCritical = false;
  if (row.guestId != null && criticalGuestIds instanceof Set) {
    isCritical = criticalGuestIds.has(Number(row.guestId));
  }
  if (
    !isCritical &&
    row.guestId != null &&
    roomNumber &&
    criticalRoomKeys instanceof Set
  ) {
    isCritical = criticalRoomKeys.has(`${Number(row.guestId)}::${roomNumber}`);
  }
  return {
    ...row,
    roomNumber,
    roomId: row.roomId ?? null,
    guestName,
    voucherCode: row.stay?.voucherCode || "",
    roomNumbers: rooms.join(", ") || roomNumber,
    isCritical,
  };
}

async function computeComplaintCriticalSets(prisma, HotelName) {
  const all = await prisma.lodging_guest_complaint.findMany({
    where: { HotelName, guestId: { not: null } },
    select: { guestId: true, roomNumber: true, stayId: true },
  });
  // Fill roomNumber from stay when blank
  const stayIds = [
    ...new Set(
      all.filter((r) => !String(r.roomNumber || "").trim()).map((r) => r.stayId),
    ),
  ];
  const stayRooms = stayIds.length
    ? await prisma.lodging_stay_room.findMany({
        where: { stayId: { in: stayIds } },
        include: { room: true },
      })
    : [];
  const stayRoomMap = new Map();
  for (const sr of stayRooms) {
    const list = stayRoomMap.get(sr.stayId) || [];
    if (sr.room?.roomNumber) list.push(sr.room.roomNumber);
    stayRoomMap.set(sr.stayId, list);
  }
  const byGuest = new Map();
  const byGuestRoom = new Map();
  for (const row of all) {
    const gid = Number(row.guestId);
    if (!gid) continue;
    byGuest.set(gid, (byGuest.get(gid) || 0) + 1);
    let rn = String(row.roomNumber || "").trim();
    if (!rn) {
      rn = (stayRoomMap.get(row.stayId) || [])[0] || "";
    }
    if (!rn) continue;
    const key = `${gid}::${rn}`;
    byGuestRoom.set(key, (byGuestRoom.get(key) || 0) + 1);
  }
  const criticalGuestIds = new Set(
    [...byGuest.entries()].filter(([, n]) => n >= 5).map(([id]) => id),
  );
  const criticalRoomKeys = new Set(
    [...byGuestRoom.entries()].filter(([, n]) => n >= 3).map(([k]) => k),
  );
  return { criticalGuestIds, criticalRoomKeys };
}

const PAYMENT_METHODS = new Set(["cash", "bank", "telebirr"]);

function normalizePaymentMethod(raw) {
  const m = String(raw || "").trim().toLowerCase();
  if (!m) return "";
  if (!PAYMENT_METHODS.has(m)) {
    throw new Error("Payment method must be cash, bank, or telebirr");
  }
  return m;
}

function normalizeCompanyFields(input = {}) {
  const isCompany = Boolean(input.isCompany);
  if (!isCompany) {
    return { isCompany: false, companyName: "", companyTin: "" };
  }
  const companyName = String(input.companyName ?? "").trim();
  const companyTin = String(input.companyTin ?? "").trim();
  if (!companyName) throw new Error("Company name is required");
  if (!companyTin) throw new Error("Company TIN is required");
  return { isCompany: true, companyName, companyTin };
}

const GUEST_FEEDBACK_INCLUDE = {
  guest: true,
  stay: {
    include: {
      guest: true,
      rooms: { include: { room: true } },
    },
  },
};

async function recalcBillTotal(prisma, billId) {
  const lines = await prisma.lodging_bill_line.findMany({
    where: { billId },
    select: {
      amountETB: true,
      taxETB: true,
      fulfillmentStatus: true,
      voided: true,
      approvalStatus: true,
    },
  });
  const totalETB = lines.reduce((s, l) => {
    if (l.voided) return s;
    const appr = String(l.approvalStatus || "").toLowerCase();
    if (appr === "pending" || appr === "rejected") return s;
    if (String(l.fulfillmentStatus || "").toLowerCase() === "cancelled") {
      return s;
    }
    return s + Number(l.amountETB || 0) + Number(l.taxETB || 0);
  }, 0);
  return prisma.lodging_bill.update({
    where: { id: billId },
    data: { totalETB },
    include: { lines: { orderBy: { id: "asc" } } },
  });
}

async function taxConfigsForKind(prisma, HotelName, kind) {
  const k = String(kind || "").trim();
  const rows = await prisma.lodging_tax_config.findMany({
    where: { HotelName, kind: k },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return rows;
}

async function taxPercentForKind(prisma, HotelName, kind) {
  const rows = await taxConfigsForKind(prisma, HotelName, kind);
  return rows.reduce((s, r) => s + (Number(r.taxPercent) || 0), 0);
}

async function applyTaxToAmounts(prisma, HotelName, kind, amountETB) {
  const rows = await taxConfigsForKind(prisma, HotelName, kind);
  const active = rows.filter((r) => Number(r.taxPercent) > 0);
  const parts = active.map((r) => {
    const percent = Number(r.taxPercent) || 0;
    return {
      name: String(r.name || "Tax").trim() || "Tax",
      percent,
      amountETB: Math.round(amountETB * percent) / 100,
    };
  });
  const taxPercent = parts.reduce((s, p) => s + p.percent, 0);
  const taxETB = Math.round(parts.reduce((s, p) => s + p.amountETB, 0) * 100) / 100;
  return {
    taxPercent,
    taxETB,
    taxParts: parts,
    taxDetailJson: JSON.stringify(parts),
    taxNames: parts.map((p) => `${p.name} ${p.percent}%`).join(", "),
  };
}

const RESERVATION_INCLUDE = {
  guest: true,
  rooms: { include: { room: true } },
};

async function generateReservationCode(prisma, HotelName, arrivalAt) {
  const day = ymd(arrivalAt instanceof Date ? arrivalAt : new Date(arrivalAt));
  for (let i = 0; i < 40; i++) {
    const code = `RSV-${day}-${pad4(Math.floor(Math.random() * 10000))}`;
    const clash = await prisma.lodging_reservation.findFirst({
      where: { HotelName, reservationCode: code },
      select: { id: true },
    });
    if (!clash) return code;
  }
  return `RSV-${day}-${Date.now().toString().slice(-4)}`;
}

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

const MS_DAY = 24 * 60 * 60 * 1000;

function dayTime(d) {
  return startOfLocalDay(d).getTime();
}

function formatDayLabel(d) {
  const x = startOfLocalDay(d);
  const dd = String(x.getDate()).padStart(2, "0");
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const yyyy = x.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * One-day cleaning gap between stays.
 * Checkout morning of earlier stay + 1 calendar day ≤ later arrival
 * (e.g. last night 21/09 → checkout 22/09 → next arrival 23/09).
 */
function staysHaveOneDayGap(arrA, depA, arrB, depB) {
  const a0 = dayTime(arrA);
  const a1 = dayTime(depA);
  const b0 = dayTime(arrB);
  const b1 = dayTime(depB);
  if (a1 + MS_DAY <= b0) return true;
  if (b1 + MS_DAY <= a0) return true;
  return false;
}

function staysConflictWithGap(arrA, depA, arrB, depB) {
  return !staysHaveOneDayGap(arrA, depA, arrB, depB);
}

const OPEN_RESERVATION_STATUSES = ["tentative", "confirmed"];

/**
 * Blocking intervals for rooms: in-house stays + open reservation holds.
 * @returns Map<roomId, Array<{ kind, label, arrival, departure, roomNumber }>>
 */
async function loadRoomBlockingIntervals(
  prisma,
  context,
  roomIds,
  tenantHotelReadWhere,
  opts = {},
) {
  const ids = [...new Set((roomIds || []).map((n) => Number(n)).filter((n) => n > 0))];
  const map = new Map();
  for (const id of ids) map.set(id, []);
  if (!ids.length) return map;

  const scope = tenantHotelReadWhere(context);
  const excludeReservationId =
    opts.excludeReservationId != null
      ? Number(opts.excludeReservationId)
      : null;
  const excludeStayId =
    opts.excludeStayId != null ? Number(opts.excludeStayId) : null;

  const stayLinks = await prisma.lodging_stay_room.findMany({
    where: {
      roomId: { in: ids },
      stay: {
        ...scope,
        status: "checked_in",
        ...(excludeStayId ? { id: { not: excludeStayId } } : {}),
      },
    },
    include: {
      stay: true,
      room: { select: { roomNumber: true } },
    },
  });

  for (const link of stayLinks) {
    const stay = link.stay;
    if (!stay) continue;
    const arrival = stay.arrivalAt || stay.reservedArrivalAt;
    const departure =
      stay.expectedDepartureAt || stay.departureAt || addDays(arrival, 1);
    if (!arrival || !departure) continue;
    const list = map.get(link.roomId) || [];
    list.push({
      kind: "checked_in",
      label: "in-house guest",
      arrival: new Date(arrival),
      departure: new Date(departure),
      roomNumber: link.room?.roomNumber || String(link.roomId),
    });
    map.set(link.roomId, list);
  }

  const resLinks = await prisma.lodging_reservation_room.findMany({
    where: {
      roomId: { in: ids },
      reservation: {
        ...scope,
        status: { in: OPEN_RESERVATION_STATUSES },
        ...(excludeReservationId
          ? { id: { not: excludeReservationId } }
          : {}),
      },
    },
    include: {
      reservation: true,
      room: { select: { roomNumber: true } },
    },
  });

  for (const link of resLinks) {
    const res = link.reservation;
    if (!res) continue;
    const arrival = res.arrivalAt;
    const departure =
      res.departureAt || addDays(arrival, Math.max(1, Number(res.nights) || 1));
    if (!arrival || !departure) continue;
    const list = map.get(link.roomId) || [];
    list.push({
      kind: "reservation",
      label: `reservation ${res.reservationCode || res.id}`,
      arrival: new Date(arrival),
      departure: new Date(departure),
      roomNumber: link.room?.roomNumber || String(link.roomId),
    });
    map.set(link.roomId, list);
  }

  return map;
}

function maxNightsBeforeBlock(arrival, blockArrival) {
  // Last allowed checkout = blockArrival - 1 day (gap day before block).
  const maxDep = startOfLocalDay(blockArrival);
  maxDep.setDate(maxDep.getDate() - 1);
  const nights = nightsFromArrivalDeparture(arrival, maxDep);
  // nightsFromArrivalDeparture returns min 1 even if invalid — check dates.
  if (dayTime(maxDep) <= dayTime(arrival)) {
    // checkout must be after arrival; if maxDep <= arrival, zero nights fit
    if (dayTime(maxDep) < dayTime(arrival)) return 0;
    // maxDep === arrival means 0-length — not a valid stay
    return 0;
  }
  return nights;
}

function maxNightsAfterBlock(arrival, blockDeparture) {
  // Earliest arrival after block = blockDeparture + 1 day.
  // If our arrival is already after that, nights unlimited by this block alone
  // (other blocks may still apply). This helper is for messaging when arrival
  // is too early.
  const earliest = startOfLocalDay(blockDeparture);
  earliest.setDate(earliest.getDate() + 1);
  if (dayTime(arrival) < dayTime(earliest)) return null; // arrival too early
  return null;
}

function describeRoomDateConflict(roomNumber, arrival, departure, blocks) {
  const arr = startOfLocalDay(arrival);
  const dep = startOfLocalDay(departure);
  for (const b of blocks) {
    if (!staysConflictWithGap(arr, dep, b.arrival, b.departure)) continue;
    const bArr = startOfLocalDay(b.arrival);
    const bDep = startOfLocalDay(b.departure);

    if (dayTime(dep) <= dayTime(bArr) || dayTime(arr) < dayTime(bArr)) {
      // Proposed stay is before or overlapping the block from the front
      const maxN = maxNightsBeforeBlock(arr, bArr);
      const lastCheckout = startOfLocalDay(bArr);
      lastCheckout.setDate(lastCheckout.getDate() - 1);
      if (maxN < 1) {
        return {
          ok: false,
          maxNights: 0,
          message: `Room ${roomNumber} is held by an ${b.label} arriving ${formatDayLabel(bArr)}. Leave a one-day cleaning gap — this arrival is too close (need arrival on or after ${formatDayLabel(addDays(bDep, 1))} or a stay that checks out by ${formatDayLabel(lastCheckout)}).`,
        };
      }
      return {
        ok: false,
        maxNights: maxN,
        message: `Room ${roomNumber} has an ${b.label} arriving ${formatDayLabel(bArr)}. Leave a one-day cleaning gap — use at most ${maxN} night(s) (checkout by ${formatDayLabel(lastCheckout)}).`,
      };
    }

    // Proposed stay is after the block but too close / overlapping
    const earliestNext = startOfLocalDay(bDep);
    earliestNext.setDate(earliestNext.getDate() + 1);
    return {
      ok: false,
      maxNights: null,
      message: `Room ${roomNumber} has an ${b.label} until ${formatDayLabel(bDep)}. Leave a one-day cleaning gap — earliest arrival is ${formatDayLabel(earliestNext)}.`,
    };
  }
  return { ok: true, message: "", maxNights: null };
}

function evaluateRoomDateFit(room, arrivalAt, nights, blocks) {
  const st = String(room.status || "");
  if (
    st === "out_of_order" ||
    st === "out_of_service" ||
    st === "blocked"
  ) {
    return {
      ok: false,
      message: `Room ${room.roomNumber} is ${st.replace(/_/g, " ")}`,
      maxNights: 0,
    };
  }
  const nightsN = Math.max(1, Math.floor(Number(nights) || 1));
  const arrival = startOfLocalDay(arrivalAt);
  const departure = addDays(arrival, nightsN);

  if (st === "vacant_dirty" || st === "on_maintenance") {
    const end = room.statusExpectedEndAt || room.maintenanceUntil || null;
    if (!end) {
      return {
        ok: false,
        message: `Room ${room.roomNumber} is ${st.replace(/_/g, " ")} with no expected end date`,
        maxNights: 0,
      };
    }
    if (dayTime(end) >= dayTime(arrival)) {
      return {
        ok: false,
        message: `Room ${room.roomNumber} remains ${st.replace(/_/g, " ")} until ${formatDayLabel(end)}`,
        maxNights: 0,
      };
    }
  }

  // Occupied: never allow check-in now; reservations only after departure + gap
  // (handled by blocking intervals from the in-house stay).

  return describeRoomDateConflict(
    room.roomNumber,
    arrival,
    departure,
    blocks || [],
  );
}

/**
 * Rooms that can be held / used for arrival + nights with a one-day cleaning gap
 * vs in-house stays and other open reservations.
 */
async function findHoldableRooms(
  prisma,
  context,
  arrivalAt,
  tenantHotelReadWhere,
  opts = {},
) {
  const nightsN = Math.max(1, Math.floor(Number(opts.nights) || 1));
  const arrival = startOfLocalDay(arrivalAt);
  const scope = tenantHotelReadWhere(context);
  const rooms = await prisma.lodging_room.findMany({
    where: {
      ...scope,
      status: {
        notIn: ["out_of_order", "out_of_service", "blocked"],
      },
    },
    orderBy: [{ floor: "asc" }, { roomNumber: "asc" }],
  });

  const candidates = rooms.filter((r) => {
    if (r.status === "vacant_clean" || r.status === "inspected") return true;
    if (r.status === "reserved" || r.status === "occupied") return true;
    if (r.status === "vacant_dirty" || r.status === "on_maintenance") {
      const end = r.statusExpectedEndAt || r.maintenanceUntil || null;
      if (!end) return false;
      return dayTime(end) < dayTime(arrival);
    }
    return false;
  });

  const blocksByRoom = await loadRoomBlockingIntervals(
    prisma,
    context,
    candidates.map((r) => r.id),
    tenantHotelReadWhere,
    {
      excludeReservationId: opts.excludeReservationId,
      excludeStayId: opts.excludeStayId,
    },
  );

  return candidates.filter((r) => {
    const fit = evaluateRoomDateFit(
      r,
      arrival,
      nightsN,
      blocksByRoom.get(r.id) || [],
    );
    return fit.ok;
  });
}

async function assertRoomsFitDates(
  prisma,
  context,
  rooms,
  arrivalAt,
  nights,
  tenantHotelReadWhere,
  opts = {},
) {
  const ids = rooms.map((r) => r.id);
  const blocksByRoom = await loadRoomBlockingIntervals(
    prisma,
    context,
    ids,
    tenantHotelReadWhere,
    opts,
  );
  for (const r of rooms) {
    if (opts.forCheckIn && String(r.status || "") === "occupied") {
      throw new Error(
        `Room ${r.roomNumber} is occupied — priority stays with the in-house guest`,
      );
    }
    const fit = evaluateRoomDateFit(
      r,
      arrivalAt,
      nights,
      blocksByRoom.get(r.id) || [],
    );
    if (!fit.ok) {
      throw new Error(fit.message || `Room ${r.roomNumber} is not available`);
    }
  }
}

/** After hold/release/check-in, set reserved vs vacant_clean vs occupied correctly. */
async function reconcileRoomHoldStatus(tx, roomId, actorName) {
  const room = await tx.lodging_room.findUnique({ where: { id: roomId } });
  if (!room) return;
  const st = String(room.status || "");
  if (
    st === "out_of_order" ||
    st === "out_of_service" ||
    st === "blocked" ||
    st === "on_maintenance" ||
    st === "vacant_dirty"
  ) {
    return;
  }

  const activeStay = await tx.lodging_stay_room.findFirst({
    where: { roomId, stay: { status: "checked_in" } },
    select: { id: true },
  });
  if (activeStay) {
    if (st !== "occupied") {
      await tx.lodging_room.update({
        where: { id: roomId },
        data: {
          status: "occupied",
          maintenanceUntil: null,
          statusExpectedEndAt: null,
          updatedBy: actorName,
        },
      });
    }
    return;
  }

  const activeHold = await tx.lodging_reservation_room.findFirst({
    where: {
      roomId,
      reservation: { status: { in: OPEN_RESERVATION_STATUSES } },
    },
    select: { id: true },
  });
  if (activeHold) {
    if (st === "vacant_clean" || st === "inspected" || st === "reserved") {
      if (st !== "reserved") {
        await tx.lodging_room.update({
          where: { id: roomId },
          data: { status: "reserved", updatedBy: actorName },
        });
      }
    }
    return;
  }

  if (st === "reserved") {
    await tx.lodging_room.update({
      where: { id: roomId },
      data: { status: "vacant_clean", updatedBy: actorName },
    });
  }
}

function normalizeFulfillmentStatus(raw) {
  const s = String(raw || "pending").trim().toLowerCase();
  if (s === "completed" || s === "cancelled" || s === "pending") return s;
  return null;
}

/**
 * Mirror café Order status onto the linked food_drink bill line (room service).
 */
export async function syncCafeOrderFulfillmentToBillLine(prisma, order, actorLabel = "") {
  if (!order || !isRoomServiceTableNo(order.tableNo)) return false;
  const stayId = stayIdFromRoomServiceTableNo(order.tableNo);
  if (!stayId) return false;
  const stay = await prisma.lodging_stay.findUnique({
    where: { id: stayId },
    include: {
      bill: { include: { lines: { orderBy: { id: "asc" } } } },
    },
  });
  if (!stay?.bill) return false;

  const oid = Number(order.id);
  const match = stay.bill.lines.find(
    (l) =>
      String(l.kind || "").toLowerCase() === "food_drink" &&
      cafeOrderIdFromBillDescription(l.description) === oid,
  );
  if (!match) return false;

  const st = String(order.status || "").toLowerCase();
  let fulfillmentStatus = "pending";
  if (st === "completed") fulfillmentStatus = "completed";
  if (st === "cancelled") fulfillmentStatus = "cancelled";

  const data = {
    fulfillmentStatus,
    fulfilledAt:
      fulfillmentStatus === "pending" ? null : new Date(),
    fulfilledBy:
      fulfillmentStatus === "pending" ? "" : String(actorLabel || "").trim(),
  };
  if (fulfillmentStatus === "cancelled") {
    data.amountETB = 0;
    data.voided = true;
    data.voidedAt = new Date();
    data.voidedBy = String(actorLabel || "").trim() || "Kitchen/Bar";
    data.voidReason = "Order cancelled";
  }

  await prisma.lodging_bill_line.update({
    where: { id: match.id },
    data,
  });
  await recalcBillTotal(prisma, stay.bill.id);
  return true;
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

  const assertCmPortal = async (context) => {
    assertRole(context, ["CMLeader", "Reception", "Manager", "Admin"]);
    const role = String(context.user?.Role ?? context.user?.role ?? "")
      .trim()
      .toLowerCase();
    if (role !== "reception") return;
    const tin = tenantScopeFromContext(context);
    if (!tin) throw new Error("Tenant scope missing");
    const account = await prisma.tenant_account.findUnique({
      where: { tinNumber: tin },
      select: { receptionCmPortalEnabled: true },
    });
    if (!account?.receptionCmPortalEnabled) {
      throw new Error(
        "Reception CM portal is not enabled. Ask a Manager to allow it.",
      );
    }
  };

  const assertLodgingRead = (context) =>
    assertRole(context, [
      "Reception",
      "CMLeader",
      "Manager",
      "Admin",
    ]);

  /** Late-bound Mutation map so checkInLodgingReservation can call createLodgingStay. */
  const selfMutation = {};

  const resolvers = {
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
        await assertCmPortal(context);
        const scope = tenantHotelReadWhere(context);
        const rooms = await prisma.lodging_room.findMany({
          where: {
            ...scope,
            status: { in: ["vacant_dirty", "on_maintenance", "inspected"] },
          },
          orderBy: [{ status: "asc" }, { roomNumber: "asc" }],
        });
        if (rooms.length === 0) return [];

        const inProgress = await prisma.lodging_cm_assignment.findMany({
          where: {
            status: "open",
            workKind: { in: ["cleaning", "maintenance"] },
            roomId: { in: rooms.map((r) => r.id) },
          },
          select: { roomId: true },
        });
        const busy = new Set(inProgress.map((a) => a.roomId));
        // Rooms with open cleaning/maintenance stay off the queue until done.
        return rooms.filter((r) => !busy.has(r.id));
      },

      lodgingHoldableRooms: async (
        _,
        { arrivalAt, nights, excludeReservationId },
        context,
      ) => {
        assertReceptionOrManager(context);
        const arrival = new Date(arrivalAt);
        if (Number.isNaN(arrival.getTime())) throw new Error("Invalid arrivalAt");
        return findHoldableRooms(
          prisma,
          context,
          arrival,
          tenantHotelReadWhere,
          {
            nights: nights != null ? Number(nights) : 1,
            excludeReservationId:
              excludeReservationId != null
                ? Number(excludeReservationId)
                : null,
          },
        );
      },

      lodgingRoomDateFit: async (
        _,
        { roomId, arrivalAt, nights, excludeReservationId },
        context,
      ) => {
        assertReceptionOrManager(context);
        const arrival = new Date(arrivalAt);
        if (Number.isNaN(arrival.getTime())) throw new Error("Invalid arrivalAt");
        const nightsN = Math.max(1, Math.floor(Number(nights) || 1));
        const room = await prisma.lodging_room.findUnique({
          where: { id: Number(roomId) },
        });
        if (!room || !tenantHotelReadMatches(context, room.HotelName)) {
          return {
            ok: false,
            message: "Room not found",
            maxNights: 0,
          };
        }
        const blocksByRoom = await loadRoomBlockingIntervals(
          prisma,
          context,
          [room.id],
          tenantHotelReadWhere,
          { excludeReservationId },
        );
        return evaluateRoomDateFit(
          room,
          arrival,
          nightsN,
          blocksByRoom.get(room.id) || [],
        );
      },

      lodgingGuests: async (_, { search }, context) => {
        assertReceptionOrManager(context);
        const q = String(search ?? "").trim();
        const base = tenantHotelReadWhere(context);
        let rows;
        if (!q) {
          rows = await prisma.lodging_guest.findMany({
            where: base,
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
            take: 500,
          });
        } else {
          rows = await prisma.lodging_guest.findMany({
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
        }
        return withGuestStayDates(prisma, rows);
      },

      lodgingGuest: async (_, { id }, context) => {
        assertReceptionOrManager(context);
        const guest = await prisma.lodging_guest.findUnique({
          where: { id: Number(id) },
        });
        if (!guest || !tenantHotelReadMatches(context, guest.HotelName)) {
          return null;
        }
        return withGuestStayDates(prisma, guest);
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
        // Payment report: only checked-out stays, keyed by departure (checkout) day.
        return prisma.lodging_stay.findMany({
          where: {
            ...tenantHotelReadWhere(context),
            status: "checked_out",
            departureAt: { gte: fromDt, lte: toDt },
          },
          include: STAY_INCLUDE,
          orderBy: { departureAt: "asc" },
        });
      },

      lodgingPoliceGuestReport: async (_, { from, to }, context) => {
        assertAdminOrManager(context);
        const fromDt = new Date(from);
        const toDt = new Date(to);
        if (Number.isNaN(fromDt.getTime()) || Number.isNaN(toDt.getTime())) {
          throw new Error("Invalid date range");
        }
        if (toDt < fromDt) throw new Error("to must be on or after from");

        // Guests whose stay overlapped the window (still in-house or checked out).
        const rows = await prisma.lodging_stay.findMany({
          where: {
            ...tenantHotelReadWhere(context),
            OR: [
              {
                status: "checked_in",
                arrivalAt: { lte: toDt },
              },
              {
                status: "checked_out",
                arrivalAt: { lte: toDt },
                departureAt: { gte: fromDt },
              },
            ],
          },
          include: STAY_INCLUDE,
          orderBy: [{ arrivalAt: "asc" }, { id: "asc" }],
        });
        return rows;
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
        await assertCmPortal(context);
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
        const todayStart = startOfLocalDay(new Date());
        const todayEnd = endOfLocalDay(new Date());
        const [
          vacantClean,
          vacantDirty,
          occupied,
          onMaintenance,
          reserved,
          inspected,
          outOfOrder,
          outOfService,
          blocked,
          activeStays,
          openCmAssignments,
          todayCheckIns,
          todayCheckOuts,
          openReservations,
          roomTotal,
          openBills,
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
          prisma.lodging_room.count({
            where: { ...scope, status: "reserved" },
          }),
          prisma.lodging_room.count({
            where: { ...scope, status: "inspected" },
          }),
          prisma.lodging_room.count({
            where: { ...scope, status: "out_of_order" },
          }),
          prisma.lodging_room.count({
            where: { ...scope, status: "out_of_service" },
          }),
          prisma.lodging_room.count({
            where: { ...scope, status: "blocked" },
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
          prisma.lodging_stay.count({
            where: {
              ...scope,
              status: "checked_in",
              arrivalAt: { gte: todayStart, lte: todayEnd },
            },
          }),
          prisma.lodging_stay.count({
            where: {
              ...scope,
              status: "checked_out",
              departureAt: { gte: todayStart, lte: todayEnd },
            },
          }),
          prisma.lodging_reservation.count({
            where: {
              ...scope,
              status: { in: ["tentative", "confirmed"] },
            },
          }),
          prisma.lodging_room.count({ where: scope }),
          prisma.lodging_bill.findMany({
            where: { ...scope, status: "open" },
            select: { totalETB: true },
          }),
        ]);
        const sellable =
          vacantClean + vacantDirty + occupied + reserved + inspected;
        const occupancyPercent =
          sellable > 0 ? Math.round((occupied / sellable) * 1000) / 10 : 0;
        const outstandingBalanceETB = openBills.reduce(
          (s, b) => s + Number(b.totalETB || 0),
          0,
        );
        return {
          vacantClean,
          vacantDirty,
          occupied,
          onMaintenance,
          reserved,
          inspected,
          outOfOrder,
          outOfService,
          blocked,
          activeStays,
          openCmAssignments,
          todayCheckIns,
          todayCheckOuts,
          openReservations,
          occupancyPercent,
          outstandingBalanceETB,
        };
      },

      lodgingSearch: async (_, { query }, context) => {
        assertReceptionOrManager(context);
        const q = String(query ?? "").trim();
        if (!q) return [];
        const scope = tenantHotelReadWhere(context);
        return prisma.lodging_stay.findMany({
          where: {
            AND: [
              scope,
              {
                OR: [
                  { voucherCode: { contains: q } },
                  { guest: { firstName: { contains: q } } },
                  { guest: { lastName: { contains: q } } },
                  { guest: { phone: { contains: q } } },
                  { guest: { nationalId: { contains: q } } },
                  { guest: { passportNumber: { contains: q } } },
                  {
                    rooms: {
                      some: { room: { roomNumber: { contains: q } } },
                    },
                  },
                ],
              },
            ],
          },
          include: STAY_INCLUDE,
          orderBy: { arrivalAt: "desc" },
          take: 40,
        });
      },

      lodgingReservations: async (_, { status, from, to }, context) => {
        assertReceptionOrManager(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (status) {
          const s = String(status).trim();
          if (!RESERVATION_STATUSES.has(s)) throw new Error("Invalid status");
          where.status = s;
        } else {
          // Active board: cancel/check-in remove the booking from this list.
          where.status = { notIn: ["cancelled", "checked_in"] };
        }
        if (from || to) {
          where.arrivalAt = {};
          if (from) where.arrivalAt.gte = new Date(from);
          if (to) where.arrivalAt.lte = new Date(to);
        }
        return prisma.lodging_reservation.findMany({
          where,
          include: RESERVATION_INCLUDE,
          orderBy: { arrivalAt: "asc" },
          take: 300,
        });
      },

      lodgingReservation: async (_, { id }, context) => {
        assertReceptionOrManager(context);
        const row = await prisma.lodging_reservation.findUnique({
          where: { id: Number(id) },
          include: RESERVATION_INCLUDE,
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) return null;
        return row;
      },

      lodgingTaxConfigs: async (_, __, context) => {
        assertReceptionOrManager(context);
        return prisma.lodging_tax_config.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: { kind: "asc" },
        });
      },

      pendingLodgingDiscounts: async (_, __, context) => {
        assertAdminOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return prisma.lodging_bill_line.findMany({
          where: {
            kind: "discount",
            approvalStatus: "pending",
            voided: false,
            bill: { HotelName, status: "open" },
          },
          orderBy: { createdAt: "asc" },
          take: 200,
        });
      },

      lodgingRatePlans: async (_, { activeOnly }, context) => {
        assertReceptionOrManager(context);
        const where = { ...tenantHotelReadWhere(context) };
        if (activeOnly) where.isActive = true;
        return prisma.lodging_rate_plan.findMany({
          where,
          orderBy: [{ priority: "desc" }, { name: "asc" }],
        });
      },

      lodgingPerformanceReport: async (_, { fromDate, toDate }, context) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const fromStr = String(fromDate || "").trim();
        const toStr = String(toDate || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
          throw new Error("fromDate and toDate must be YYYY-MM-DD");
        }
        if (fromStr > toStr) throw new Error("fromDate must be on or before toDate");
        const from = new Date(`${fromStr}T00:00:00`);
        const to = new Date(`${toStr}T23:59:59.999`);
        const dayMs = 24 * 60 * 60 * 1000;
        const days =
          Math.max(
            1,
            Math.round(
              (startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) /
                dayMs,
            ) + 1,
          );
        const roomCount = await prisma.lodging_room.count({
          where: { HotelName },
        });
        const availableRoomNights = roomCount * days;

        const stays = await prisma.lodging_stay.findMany({
          where: {
            HotelName,
            status: { in: ["checked_in", "checked_out"] },
            arrivalAt: { lte: to },
            departureAt: { gte: from },
          },
          include: {
            rooms: { include: { room: true } },
            bill: { include: { lines: true } },
            reservation: true,
          },
        });

        let roomNightsSold = 0;
        let roomRevenueETB = 0;
        let staysCheckedOut = 0;
        let staysInHouse = 0;
        const byType = new Map();
        const bySource = new Map();

        for (const stay of stays) {
          const arr = startOfLocalDay(stay.arrivalAt);
          const dep = startOfLocalDay(stay.departureAt);
          const overlapStart = Math.max(arr.getTime(), startOfLocalDay(from).getTime());
          const overlapEnd = Math.min(
            dep.getTime(),
            startOfLocalDay(to).getTime() + dayMs,
          );
          const overlapNights = Math.max(
            0,
            Math.round((overlapEnd - overlapStart) / dayMs),
          );
          const roomQty = Math.max(1, (stay.rooms || []).length);
          const sold = overlapNights * roomQty;
          roomNightsSold += sold;

          if (stay.status === "checked_out") staysCheckedOut += 1;
          if (stay.status === "checked_in") staysInHouse += 1;

          const lines = stay.bill?.lines || [];
          let stayRoomRev = 0;
          for (const line of lines) {
            if (line.voided) continue;
            if (String(line.kind).toLowerCase() !== "room") continue;
            if (String(line.approvalStatus || "").toLowerCase() === "pending") {
              continue;
            }
            stayRoomRev += Number(line.amountETB) || 0;
          }
          // Attribute revenue by overlap share of stay nights.
          const stayNights = Math.max(1, Number(stay.nights) || overlapNights || 1);
          const share = Math.min(1, overlapNights / stayNights);
          const attributed = stayRoomRev * share;
          roomRevenueETB += attributed;

          for (const sr of stay.rooms || []) {
            const rt = sr.roomType || sr.room?.roomType || "Unknown";
            const row = byType.get(rt) || {
              roomType: rt,
              roomNightsSold: 0,
              roomRevenueETB: 0,
            };
            row.roomNightsSold += overlapNights;
            row.roomRevenueETB += attributed / roomQty;
            byType.set(rt, row);
          }

          const source = stay.reservation?.source || "walk_in";
          const src = bySource.get(source) || {
            source,
            stays: 0,
            roomRevenueETB: 0,
          };
          src.stays += 1;
          src.roomRevenueETB += attributed;
          bySource.set(source, src);
        }

        const adrETB =
          roomNightsSold > 0 ? roomRevenueETB / roomNightsSold : 0;
        const revparETB =
          availableRoomNights > 0
            ? roomRevenueETB / availableRoomNights
            : 0;
        const occupancyPercent =
          availableRoomNights > 0
            ? (roomNightsSold / availableRoomNights) * 100
            : 0;

        return {
          fromDate: fromStr,
          toDate: toStr,
          roomNightsSold,
          availableRoomNights,
          occupancyPercent: Math.round(occupancyPercent * 100) / 100,
          roomRevenueETB: Math.round(roomRevenueETB * 100) / 100,
          adrETB: Math.round(adrETB * 100) / 100,
          revparETB: Math.round(revparETB * 100) / 100,
          staysCheckedOut,
          staysInHouse,
          byRoomType: [...byType.values()].map((r) => ({
            ...r,
            roomRevenueETB: Math.round(r.roomRevenueETB * 100) / 100,
            adrETB:
              r.roomNightsSold > 0
                ? Math.round((r.roomRevenueETB / r.roomNightsSold) * 100) / 100
                : 0,
          })),
          bySource: [...bySource.values()].map((r) => ({
            ...r,
            roomRevenueETB: Math.round(r.roomRevenueETB * 100) / 100,
          })),
        };
      },

      lodgingBusinessDay: async (_, { businessDate }, context) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const day =
          String(businessDate || "").trim() || ymdLocal(new Date());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          throw new Error("businessDate must be YYYY-MM-DD");
        }
        // Prefer an open shift for the day; else latest closed for that day.
        const open = await prisma.lodging_business_day.findFirst({
          where: { HotelName, businessDate: day, status: "open" },
          orderBy: { fromAt: "desc" },
        });
        if (open) return open;
        return prisma.lodging_business_day.findFirst({
          where: { HotelName, businessDate: day },
          orderBy: { fromAt: "desc" },
        });
      },

      lodgingBusinessDays: async (_, { limit }, context) => {
        assertReceptionOrManager(context);
        return prisma.lodging_business_day.findMany({
          where: tenantHotelReadWhere(context),
          orderBy: [{ fromAt: "desc" }],
          take: Math.min(100, Math.max(1, Number(limit) || 30)),
        });
      },

      lodgingReceptionists: async (_, { includeInactive }, context) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        return prisma.lodging_receptionist.findMany({
          where: {
            HotelName,
            ...(includeInactive ? {} : { isActive: true }),
          },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        });
      },

      lodgingGuestComplaints: async (_, { status, limit }, context) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const where = { ...tenantHotelReadWhere(context) };
        if (status) where.status = String(status).trim();
        const rows = await prisma.lodging_guest_complaint.findMany({
          where,
          include: GUEST_FEEDBACK_INCLUDE,
          orderBy: { createdAt: "desc" },
          take: Math.min(200, Math.max(1, Number(limit) || 50)),
        });
        const { criticalGuestIds, criticalRoomKeys } =
          await computeComplaintCriticalSets(prisma, HotelName);
        return rows.map((r) =>
          enrichGuestFeedbackRow(r, criticalGuestIds, criticalRoomKeys),
        );
      },

      lodgingGuestComplaintHistory: async (_, { guestId, limit }, context) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const gid = Number(guestId);
        if (!gid) throw new Error("guestId is required");
        const rows = await prisma.lodging_guest_complaint.findMany({
          where: { HotelName, guestId: gid },
          include: GUEST_FEEDBACK_INCLUDE,
          orderBy: { createdAt: "desc" },
          take: Math.min(200, Math.max(1, Number(limit) || 50)),
        });
        const { criticalGuestIds, criticalRoomKeys } =
          await computeComplaintCriticalSets(prisma, HotelName);
        return rows.map((r) =>
          enrichGuestFeedbackRow(r, criticalGuestIds, criticalRoomKeys),
        );
      },

      lodgingGuestRatings: async (_, { limit }, context) => {
        assertReceptionOrManager(context);
        const rows = await prisma.lodging_guest_rating.findMany({
          where: tenantHotelReadWhere(context),
          include: GUEST_FEEDBACK_INCLUDE,
          orderBy: { createdAt: "desc" },
          take: Math.min(200, Math.max(1, Number(limit) || 50)),
        });
        return rows.map((r) => enrichGuestFeedbackRow(r));
      },

      lodgingGuestRatingHistory: async (_, { guestId, limit }, context) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const gid = Number(guestId);
        if (!gid) throw new Error("guestId is required");
        const rows = await prisma.lodging_guest_rating.findMany({
          where: { HotelName, guestId: gid },
          include: GUEST_FEEDBACK_INCLUDE,
          orderBy: { createdAt: "desc" },
          take: Math.min(200, Math.max(1, Number(limit) || 50)),
        });
        return rows.map((r) => enrichGuestFeedbackRow(r));
      },
    },

    Mutation: {
      createLodgingRoom: async (
        _,
        {
          roomNumber,
          roomType,
          floor,
          pricePerNightETB,
          bedType,
          capacity,
          amenities,
          imageUrl,
          notes,
        },
        context,
      ) => {
        assertAdminOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName, actorRole } = actorFromContext(context);
        const rn = String(roomNumber).trim();
        if (!rn) throw new Error("Room number is required");
        const cap = Math.max(1, Math.floor(Number(capacity) || 2));
        const room = await prisma.lodging_room.create({
          data: {
            HotelName,
            roomNumber: rn,
            roomType: String(roomType).trim(),
            floor: String(floor ?? "").trim(),
            pricePerNightETB: Number(pricePerNightETB) || 0,
            bedType: String(bedType ?? "").trim(),
            capacity: cap,
            amenities: String(amenities ?? "").trim(),
            imageUrl: String(imageUrl ?? "").trim(),
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
          bedType,
          capacity,
          amenities,
          imageUrl,
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
        if (bedType != null) data.bedType = String(bedType).trim();
        if (capacity != null)
          data.capacity = Math.max(1, Math.floor(Number(capacity) || 2));
        if (amenities != null) data.amenities = String(amenities).trim();
        if (imageUrl != null) data.imageUrl = String(imageUrl).trim();
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
        { id, kind, name, unitPriceETB, unitLabel, imageUrl, isActive },
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
          imageUrl: String(imageUrl ?? "").trim(),
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
        return withGuestStayDates(prisma, guest);
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
          reservationId,
          ratePlanId,
          isCompany,
          companyName,
          companyTin,
        },
        context,
      ) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName, actorRole } = actorFromContext(context);

        const nightsN = Math.max(1, Math.floor(Number(nights) || 1));
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

        let linkedReservation = null;
        if (reservationId != null) {
          linkedReservation = await prisma.lodging_reservation.findUnique({
            where: { id: Number(reservationId) },
            include: { rooms: true },
          });
          if (
            !linkedReservation ||
            !tenantHotelReadMatches(context, linkedReservation.HotelName)
          ) {
            throw new Error("Reservation not found");
          }
          if (
            linkedReservation.status === "cancelled" ||
            linkedReservation.status === "no_show" ||
            linkedReservation.status === "checked_in"
          ) {
            throw new Error("Reservation cannot be checked in");
          }
        }

        const heldRoomIds = new Set(
          (linkedReservation?.rooms || [])
            .map((rr) => Number(rr.roomId))
            .filter((n) => n > 0),
        );

        const rooms = await prisma.lodging_room.findMany({
          where: { id: { in: ids }, ...tenantHotelReadWhere(context) },
        });
        if (rooms.length !== ids.length) {
          throw new Error("One or more rooms not found");
        }
        for (const r of rooms) {
          const st = String(r.status || "");
          if (st === "occupied") {
            throw new Error(
              `Room ${r.roomNumber} is occupied — priority stays with the in-house guest`,
            );
          }
          if (
            st === "out_of_order" ||
            st === "out_of_service" ||
            st === "blocked"
          ) {
            throw new Error(
              `Room ${r.roomNumber} is not available for check-in (current: ${st})`,
            );
          }
        }
        await assertRoomsFitDates(
          prisma,
          context,
          rooms,
          arrival,
          nightsN,
          tenantHotelReadWhere,
          {
            forCheckIn: true,
            excludeReservationId: linkedReservation?.id ?? null,
            heldRoomIds,
          },
        );

        let guest;
        if (guestId != null) {
          guest = await prisma.lodging_guest.findUnique({
            where: { id: Number(guestId) },
          });
          if (!guest || !tenantHotelReadMatches(context, guest.HotelName)) {
            throw new Error("Guest not found");
          }
        } else if (linkedReservation?.guestId) {
          guest = await prisma.lodging_guest.findUnique({
            where: { id: linkedReservation.guestId },
          });
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
          let frozenPlanId = null;
          let frozenPlanName = "";
          // Resolve rate once from first room (or forced plan) for stay freeze.
          if (rooms[0]) {
            const seed = await unitPriceForRoomNight(
              tx,
              HotelName,
              rooms[0],
              arrival,
              nightsN,
              ratePlanId ?? null,
            );
            frozenPlanId = seed.ratePlanId;
            frozenPlanName = seed.ratePlanName;
          }

          const company = normalizeCompanyFields({
            isCompany:
              isCompany != null
                ? isCompany
                : Boolean(linkedReservation?.isCompany),
            companyName:
              companyName != null
                ? companyName
                : linkedReservation?.companyName || "",
            companyTin:
              companyTin != null
                ? companyTin
                : linkedReservation?.companyTin || "",
          });

          const created = await tx.lodging_stay.create({
            data: {
              HotelName,
              voucherCode,
              guestId: guest.id,
              reservationId: linkedReservation ? linkedReservation.id : null,
              status: stayStatus,
              arrivalAt: arrival,
              reservedArrivalAt: linkedReservation
                ? linkedReservation.arrivalAt
                : null,
              departureAt,
              expectedNights: nightsN,
              expectedDepartureAt: departureAt,
              nights: nightsN,
              adults: Math.max(1, Number(adults) || 1),
              children: Math.max(0, Number(children) || 0),
              preferredRoomType: String(preferredRoomType ?? "").trim(),
              ratePlanId: frozenPlanId,
              ratePlanName: frozenPlanName,
              isCompany: company.isCompany,
              companyName: company.companyName,
              companyTin: company.companyTin,
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
                statusExpectedEndAt: null,
                updatedBy: actorName,
              },
            });
          }

          if (linkedReservation) {
            await tx.lodging_reservation.update({
              where: { id: linkedReservation.id },
              data: { status: "checked_in", updatedBy: actorName },
            });
            for (const rr of linkedReservation.rooms || []) {
              if (rr.roomId && !ids.includes(rr.roomId)) {
                await reconcileRoomHoldStatus(tx, rr.roomId, actorName);
              }
            }
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
            const priced = await unitPriceForRoomNight(
              tx,
              HotelName,
              r,
              arrival,
              nightsN,
              frozenPlanId,
            );
            const unit = priced.unit;
            const amount = unit * nightsN;
            const { taxPercent, taxETB, taxDetailJson } = await applyTaxToAmounts(
              tx,
              HotelName,
              "room",
              amount,
            );
            total += amount + taxETB;
            const planLabel = priced.ratePlanName
              ? ` · ${priced.ratePlanName}`
              : "";
            await tx.lodging_bill_line.create({
              data: {
                billId: bill.id,
                kind: "room",
                description: `Room ${r.roomNumber} × ${nightsN} night(s)${planLabel}`,
                quantity: nightsN,
                unitPriceETB: unit,
                amountETB: amount,
                taxPercent,
                taxETB,
                taxDetailJson,
                roomNumber: r.roomNumber,
                createdBy: actorName,
              },
            });
          }

          const deposit = Math.max(
            0,
            Number(linkedReservation?.depositETB) || 0,
          );
          if (deposit > 0) {
            await tx.lodging_bill_line.create({
              data: {
                billId: bill.id,
                kind: "other",
                description: "Reservation deposit applied",
                quantity: 1,
                unitPriceETB: deposit,
                amountETB: -deposit,
                taxPercent: 0,
                taxETB: 0,
                roomNumber: rooms[0]?.roomNumber || "",
                fulfillmentStatus: "completed",
                approvalStatus: "approved",
                approvedBy: actorName,
                approvedAt: new Date(),
                approvalNote: "Reservation deposit",
                createdBy: actorName,
              },
            });
            total -= deposit;
          }

          await tx.lodging_bill.update({
            where: { id: bill.id },
            data: { totalETB: Math.round(total * 100) / 100 },
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
            expectedNights: nightsN,
            reservationId: linkedReservation?.id ?? null,
          },
        });

        if (stayStatus === "checked_in") {
          await issueUniqueGuestOtp(prisma, stay.id);
          await logLodgingAction(prisma, {
            HotelName,
            actorRole,
            actorName,
            action: "issue_guest_otp",
            entityType: "lodging_stay",
            entityId: stay.id,
            stayId: stay.id,
            detail: { reason: "check_in" },
          });
        }

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

        if (data.nights != null && data.nights !== stay.nights) {
          await syncRoomNightCharges(
            prisma,
            updated,
            data.nights,
            actorName,
          );
        }

        const becameCheckedIn =
          data.status === "checked_in" && stay.status !== "checked_in";
        const becameCancelled =
          data.status === "cancelled" && stay.status !== "cancelled";

        if (becameCancelled) {
          await clearGuestOtp(prisma, stay.id);
          await logLodgingAction(prisma, {
            HotelName: stay.HotelName,
            actorRole,
            actorName,
            action: "clear_guest_otp",
            entityType: "lodging_stay",
            entityId: stay.id,
            stayId: stay.id,
            detail: { reason: "cancelled" },
          });
        } else if (
          (becameCheckedIn || updated.status === "checked_in") &&
          !String(updated.guestOtp || "").trim()
        ) {
          await issueUniqueGuestOtp(prisma, stay.id);
          await logLodgingAction(prisma, {
            HotelName: stay.HotelName,
            actorRole,
            actorName,
            action: "issue_guest_otp",
            entityType: "lodging_stay",
            entityId: stay.id,
            stayId: stay.id,
            detail: {
              reason: becameCheckedIn ? "check_in" : "missing_otp",
            },
          });
        }

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
        return prisma.lodging_stay.findUnique({
          where: { id: stay.id },
          include: STAY_INCLUDE,
        });
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
        const amountETB = qty * unit;
        const { taxPercent, taxETB, taxDetailJson } = await applyTaxToAmounts(
          prisma,
          stay.HotelName,
          k,
          amountETB,
        );

        const line = await prisma.lodging_bill_line.create({
          data: {
            billId: bill.id,
            kind: k,
            description: String(description).trim(),
            quantity: qty,
            unitPriceETB: unit,
            amountETB,
            taxPercent,
            taxETB,
            taxDetailJson,
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
        if (String(line.fulfillmentStatus || "").toLowerCase() === "completed") {
          throw new Error("Completed lines cannot be edited");
        }
        if (String(line.fulfillmentStatus || "").toLowerCase() === "cancelled") {
          throw new Error("Cancelled lines cannot be edited");
        }
        const qty = Number(quantity);
        if (!(qty > 0)) throw new Error("Quantity must be positive");
        if (!Number.isInteger(qty) && String(line.kind).toLowerCase() === "food_drink") {
          throw new Error("Food & drink quantity must be a whole number");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const unit = Number(line.unitPriceETB) || 0;

        const oid =
          String(line.kind || "").toLowerCase() === "food_drink"
            ? cafeOrderIdFromBillDescription(line.description)
            : null;
        if (oid != null) {
          const cafeOrder = await prisma.order.findUnique({ where: { id: oid } });
          if (cafeOrder) {
            const st = String(cafeOrder.status || "").toLowerCase();
            if (st === "completed") {
              throw new Error(
                "Completed food & drink cannot be edited — wait for a new order or cancel before kitchen completes",
              );
            }
            if (st !== "cancelled") {
              const nextAmount = Math.max(1, Math.floor(qty));
              if (nextAmount !== Math.floor(Number(cafeOrder.orderAmount))) {
                const prevCount = Number(cafeOrder.orderRevisionCount) || 0;
                await prisma.order.update({
                  where: { id: cafeOrder.id },
                  data: {
                    orderAmount: nextAmount,
                    status: "Pending",
                    orderRevisionCount: prevCount + 1,
                    orderRevisedAt: new Date(),
                  },
                });
              }
            }
          }
        }

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

        // Cancel linked café room-service ticket when removing F&B from stay.
        if (String(line.kind || "").toLowerCase() === "food_drink") {
          const oid = cafeOrderIdFromBillDescription(line.description);
          if (oid != null) {
            const cafeOrder = await prisma.order.findUnique({
              where: { id: oid },
            });
            if (
              cafeOrder &&
              String(cafeOrder.payment || "").toLowerCase() !== "paid" &&
              String(cafeOrder.status || "").toLowerCase() !== "cancelled"
            ) {
              await prisma.order.update({
                where: { id: cafeOrder.id },
                data: {
                  status: "Cancelled",
                  cancelledBy: actorName || "Reception",
                  orderRevisedAt: null,
                  orderRevisionCount: 0,
                },
              });
            }
          }
        }

        const kind = String(line.kind || "").toLowerCase();
        if (kind === "laundry" || kind === "food_drink") {
          await prisma.lodging_bill_line.update({
            where: { id: line.id },
            data: {
              fulfillmentStatus: "cancelled",
              fulfilledAt: new Date(),
              fulfilledBy: actorName || "Reception",
              amountETB: 0,
            },
          });
        } else {
          await prisma.lodging_bill_line.delete({ where: { id: line.id } });
        }
        await recalcBillTotal(prisma, billId);
        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "delete_bill_line",
          entityType: "lodging_bill_line",
          entityId: line.id,
          stayId,
          detail: { description: line.description, softCancel: kind === "laundry" || kind === "food_drink" },
        });
        return true;
      },

      setLodgingBillLineFulfillment: async (_, { lineId, status }, context) => {
        assertReceptionOrManager(context);
        const next = normalizeFulfillmentStatus(status);
        if (!next) {
          throw new Error("Status must be pending, completed, or cancelled");
        }

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

        const kind = String(line.kind || "").toLowerCase();
        // Completeness for laundry is receptionist-owned.
        // F&B completion stays with kitchen/bar (café Order) — reception may only cancel via delete.
        if (next === "completed" && kind !== "laundry") {
          throw new Error(
            "Only laundry lines can be marked completed by reception. Food & drink is completed by kitchen or bar.",
          );
        }
        if (kind !== "laundry" && kind !== "food_drink") {
          throw new Error("Fulfillment applies to laundry and food & drink lines");
        }

        const { actorName, actorRole } = actorFromContext(context);
        const unit = Number(line.unitPriceETB) || 0;
        const qty = Number(line.quantity) || 0;

        if (next === "cancelled" && kind === "food_drink") {
          const oid = cafeOrderIdFromBillDescription(line.description);
          if (oid != null) {
            const cafeOrder = await prisma.order.findUnique({ where: { id: oid } });
            if (
              cafeOrder &&
              String(cafeOrder.payment || "").toLowerCase() !== "paid" &&
              String(cafeOrder.status || "").toLowerCase() !== "cancelled"
            ) {
              await prisma.order.update({
                where: { id: cafeOrder.id },
                data: {
                  status: "Cancelled",
                  cancelledBy: actorName || "Reception",
                  orderRevisedAt: null,
                  orderRevisionCount: 0,
                },
              });
            }
          }
        }

        const updated = await prisma.lodging_bill_line.update({
          where: { id: line.id },
          data: {
            fulfillmentStatus: next,
            fulfilledAt: next === "pending" ? null : new Date(),
            fulfilledBy: next === "pending" ? "" : actorName || "Reception",
            amountETB:
              next === "cancelled" ? 0 : Math.max(0, qty) * unit,
            ...(next === "cancelled"
              ? {
                  voided: true,
                  voidedAt: new Date(),
                  voidedBy: actorName || "Reception",
                  voidReason: "Order cancelled",
                }
              : next === "pending"
                ? {
                    voided: false,
                    voidedAt: null,
                    voidedBy: "",
                    voidReason: "",
                  }
                : {}),
          },
        });
        await recalcBillTotal(prisma, line.billId);
        await logLodgingAction(prisma, {
          HotelName: line.bill.stay.HotelName,
          actorRole,
          actorName,
          action: "set_bill_line_fulfillment",
          entityType: "lodging_bill_line",
          entityId: line.id,
          stayId: line.bill.stay.id,
          detail: { status: next, kind },
        });
        return updated;
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
          if (line.voided) {
            throw new Error("Cannot transfer a voided line");
          }
          if (
            String(line.fulfillmentStatus || "").toLowerCase() === "cancelled"
          ) {
            throw new Error("Cannot transfer a cancelled order");
          }
          if (line.billId === toBill.id) {
            throw new Error("Line already on target bill");
          }
          fromBillIds.add(line.billId);
        }

        const { actorName, actorRole } = actorFromContext(context);
        await assertFoodDrinkLinesCompleted(
          prisma,
          lines,
          toStay.HotelName,
        );
        await prisma.$transaction(async (tx) => {
          await tx.lodging_bill_line.updateMany({
            where: { id: { in: ids } },
            data: { billId: toBill.id },
          });

          // Move linked café room-service tickets so payment settles on the
          // destination stay, not the former room.
          for (const line of lines) {
            if (String(line.kind || "").toLowerCase() !== "food_drink") continue;
            const oid = cafeOrderIdFromBillDescription(line.description);
            if (oid == null) continue;
            await reassignCafeOrderToStay(tx, oid, toStay);
          }
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
        const isFoodDrink = String(line.kind || "").toLowerCase() === "food_drink";
        if (isFoodDrink) {
          if (!Number.isInteger(qtyMove) || !Number.isInteger(Number(line.quantity))) {
            throw new Error(
              "Food & drink split quantity must be a whole number",
            );
          }
          await assertFoodDrinkLinesCompleted(
            prisma,
            [line],
            line.bill.HotelName,
          );
        }

        await prisma.$transaction(async (tx) => {
          await tx.lodging_bill_line.update({
            where: { id: line.id },
            data: {
              quantity: remainQty,
              amountETB: remainQty * unit,
            },
          });

          let destDescription = line.description;
          const oid = cafeOrderIdFromBillDescription(line.description);
          if (isFoodDrink && oid != null) {
            const created = await splitCafeOrderForBillLine(tx, {
              sourceOrderId: oid,
              remainQty,
              moveQty: qtyMove,
              toStay,
              actorName,
            });
            if (created?.id) {
              destDescription = withCafeOrderMarker(line.description, created.id);
            }
          }

          await tx.lodging_bill_line.create({
            data: {
              billId: toBill.id,
              kind: line.kind,
              description: destDescription,
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

      issueLodgingGuestOtp: async (_, { stayId }, context) => {
        assertReceptionOrManager(context);
        const stay = await loadStayOrThrow(
          prisma,
          context,
          stayId,
          tenantHotelReadMatches,
        );
        if (stay.status !== "checked_in") {
          throw new Error("Room code can only be issued for checked-in stays");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const otp = await issueUniqueGuestOtp(prisma, stay.id);
        await logLodgingAction(prisma, {
          HotelName: stay.HotelName,
          actorRole,
          actorName,
          action: "issue_guest_otp",
          entityType: "lodging_stay",
          entityId: stay.id,
          stayId: stay.id,
          detail: { reason: "reissue" },
        });
        return prisma.lodging_stay.findUnique({
          where: { id: stay.id },
          include: STAY_INCLUDE,
        });
      },

      checkoutLodgingStay: async (
        _,
        { stayId, departureAt, nights, cashETB, bankETB, telebirrETB },
        context,
      ) => {
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
        const computedNights = nightsFromArrivalDeparture(stay.arrivalAt, dep);
        const nightsN =
          nights != null && Number(nights) > 0
            ? Math.max(1, Math.floor(Number(nights)))
            : computedNights;

        // Drop bill lines for cancelled room-service café orders before settle.
        if (stay.bill && stay.bill.status === "open") {
          const tableNo = ROOM_SERVICE_TABLE_BASE + stay.id;
          const cancelledOrders = await prisma.order.findMany({
            where: {
              HotelName: stay.HotelName,
              tableNo,
            },
          });
          for (const order of cancelledOrders) {
            if (String(order.status || "").toLowerCase() !== "cancelled") {
              continue;
            }
            await removeRoomServiceOrderFromLodgingBill(prisma, order);
          }
        }

        const stayFresh = await loadStayOrThrow(
          prisma,
          context,
          stayId,
          tenantHotelReadMatches,
        );

        await assertFoodDrinkLinesCompleted(
          prisma,
          stayFresh.bill?.lines ?? [],
          stayFresh.HotelName,
        );
        await assertLaundryLinesCompleted(stayFresh.bill?.lines ?? []);

        const cash = Math.max(0, Number(cashETB) || 0);
        const bank = Math.max(0, Number(bankETB) || 0);
        const telebirr = Math.max(0, Number(telebirrETB) || 0);

        await prisma.$transaction(
          async (tx) => {
            await syncRoomNightCharges(tx, stayFresh, nightsN, actorName);

            // Re-apply named tax on room lines after night sync
            if (stayFresh.bill) {
              const roomLines = await tx.lodging_bill_line.findMany({
                where: {
                  billId: stayFresh.bill.id,
                  kind: "room",
                  voided: false,
                },
              });
              for (const line of roomLines) {
                const amount = Number(line.amountETB) || 0;
                const { taxPercent, taxETB, taxDetailJson } =
                  await applyTaxToAmounts(tx, stay.HotelName, "room", amount);
                await tx.lodging_bill_line.update({
                  where: { id: line.id },
                  data: { taxPercent, taxETB, taxDetailJson },
                });
              }
              await recalcBillTotal(tx, stayFresh.bill.id);
            }

            if (stayFresh.bill && stayFresh.bill.status === "open") {
              await tx.lodging_bill.update({
                where: { id: stayFresh.bill.id },
                data: {
                  status: "settled",
                  settledAt: new Date(),
                  settledBy: actorName,
                  receiptNumber,
                  cashETB: cash,
                  bankETB: bank,
                  telebirrETB: telebirr,
                },
              });
            }

            await tx.lodging_stay.update({
              where: { id: stay.id },
              data: {
                status: "checked_out",
                departureAt: dep,
                nights: nightsN,
                checkedOutBy: actorName,
                guestOtp: null,
                guestOtpIssuedAt: null,
              },
            });

            for (const sr of stayFresh.rooms || []) {
              await tx.lodging_room.update({
                where: { id: sr.roomId },
                data: {
                  status: "vacant_dirty",
                  statusExpectedEndAt: null,
                  updatedBy: actorName,
                },
              });
            }

            const orderIds = new Set();
            for (const line of stayFresh.bill?.lines ?? []) {
              if (String(line.kind || "").toLowerCase() !== "food_drink") {
                continue;
              }
              const oid = cafeOrderIdFromBillDescription(line.description);
              if (oid != null) orderIds.add(oid);
            }
            const roomServiceTable = ROOM_SERVICE_TABLE_BASE + stay.id;
            const cafeOrders = await tx.order.findMany({
              where: {
                HotelName: stay.HotelName,
                OR: [
                  ...(orderIds.size
                    ? [{ id: { in: [...orderIds] } }]
                    : []),
                  { tableNo: roomServiceTable },
                ],
              },
              select: { id: true, payment: true, status: true },
            });
            const settleIds = cafeOrders
              .filter((order) => {
                const payment = String(order.payment || "").toLowerCase();
                const status = String(order.status || "").toLowerCase();
                return payment !== "paid" && status !== "cancelled";
              })
              .map((order) => order.id);
            if (settleIds.length > 0) {
              await tx.order.updateMany({
                where: { id: { in: settleIds } },
                data: {
                  payment: "Paid",
                  status: "Completed",
                  withBank: false,
                  bankTransferAmount: null,
                  bankTipCashDeduction: null,
                },
              });
            }
          },
          { timeout: 60_000, maxWait: 15_000 },
        );

        await logLodgingAction(prisma, {
          HotelName: stay.HotelName,
          actorRole,
          actorName,
          action: "checkout_stay",
          entityType: "lodging_stay",
          entityId: stay.id,
          stayId: stay.id,
          detail: {
            departureAt: dep.toISOString(),
            nights: nightsN,
            receiptNumber,
            cashETB: cash,
            bankETB: bank,
            telebirrETB: telebirr,
            guestOtpCleared: true,
          },
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
        { roomId, status, maintenanceUntil, statusExpectedEndAt, notes },
        context,
      ) => {
        await assertCmPortal(context);
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
        const isManager = role === "manager" || role === "admin";
        const isReception = role === "reception";
        const isCm = role === "cmleader";

        if (MANAGER_ONLY_ROOM_STATUSES.has(s) && !isManager) {
          throw new Error("Only Manager can set out of order / out of service / blocked");
        }

        // While on maintenance, dirt status must not change — only leave via inspected/clean.
        if (room.status === "on_maintenance" && s === "vacant_dirty") {
          throw new Error(
            "Cannot set vacant dirty while room is on maintenance — release via inspected or vacant clean",
          );
        }

        if (isCm && !isManager && !isReception) {
          // CMLeader: vacant_dirty → inspected → vacant_clean; on_maintenance; set expected end
          const allowed = new Set([
            "inspected",
            "vacant_clean",
            "on_maintenance",
            "vacant_dirty",
          ]);
          if (!allowed.has(s)) {
            throw new Error("CMLeader may only set inspected, vacant_clean, vacant_dirty, or on_maintenance");
          }
          if (s === "inspected" && room.status !== "vacant_dirty") {
            throw new Error("Inspected is only allowed from vacant_dirty");
          }
          if (
            s === "vacant_clean" &&
            room.status !== "inspected" &&
            room.status !== "on_maintenance"
          ) {
            throw new Error(
              "Vacant clean requires inspected (or release from maintenance)",
            );
          }
        }

        if (s === "vacant_clean" && room.status === "vacant_dirty") {
          const openCleaning = await prisma.lodging_cm_assignment.count({
            where: {
              roomId: room.id,
              workKind: "cleaning",
              status: "open",
            },
          });
          if (openCleaning > 0 && !isManager && !isReception) {
            throw new Error(
              "Finish all open cleaner assignments before marking vacant clean",
            );
          }
        }

        const { actorName, actorRole } = actorFromContext(context);
        const data = {
          status: s,
          updatedBy: actorName,
        };
        if (notes != null) data.notes = String(notes).trim();

        const expected =
          statusExpectedEndAt != null
            ? new Date(statusExpectedEndAt)
            : maintenanceUntil != null
              ? new Date(maintenanceUntil)
              : null;

        if (s === "on_maintenance" || s === "vacant_dirty") {
          data.statusExpectedEndAt =
            expected && !Number.isNaN(expected.getTime())
              ? expected
              : room.statusExpectedEndAt;
          data.maintenanceUntil =
            s === "on_maintenance" ? data.statusExpectedEndAt : null;
        } else if (s === "inspected" || s === "vacant_clean") {
          data.maintenanceUntil = null;
          data.statusExpectedEndAt = null;
        } else if (MANAGER_ONLY_ROOM_STATUSES.has(s)) {
          data.maintenanceUntil = null;
          data.statusExpectedEndAt =
            expected && !Number.isNaN(expected.getTime()) ? expected : null;
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

      assignLodgingComplimentRoom: async (
        _,
        { roomId, assigneeName, note },
        context,
      ) => {
        assertAdminOrManager(context);
        const room = await loadRoomOrThrow(
          prisma,
          context,
          roomId,
          tenantHotelReadMatches,
        );
        const assignee = String(assigneeName ?? "").trim();
        if (!assignee) throw new Error("Assignee name is required");
        const st = String(room.status || "").toLowerCase();
        if (
          st === "occupied" ||
          st === "reserved" ||
          st === "on_maintenance"
        ) {
          throw new Error(
            `Room ${room.roomNumber} is ${st.replace(/_/g, " ")} — pick a vacant room`,
          );
        }
        if (
          String(room.notes || "").startsWith("COMPLIMENT|") &&
          st === "blocked"
        ) {
          throw new Error(
            `Room ${room.roomNumber} is already a complimentary staff room`,
          );
        }
        const { actorName, actorRole } = actorFromContext(context);
        const now = new Date();
        const noteText = String(note ?? "").trim().replace(/\|/g, "/");
        const notes = `COMPLIMENT|${assignee}|${actorName || "Manager"}|${now.toISOString()}|${noteText}`;
        const updated = await prisma.lodging_room.update({
          where: { id: room.id },
          data: {
            status: "blocked",
            notes,
            maintenanceUntil: null,
            statusExpectedEndAt: null,
            updatedBy: actorName,
          },
        });
        await logLodgingAction(prisma, {
          HotelName: room.HotelName,
          actorRole,
          actorName,
          action: "assign_compliment_room",
          entityType: "lodging_room",
          entityId: room.id,
          detail: {
            roomNumber: room.roomNumber,
            assignee,
            note: noteText,
          },
        });
        return updated;
      },

      updateLodgingComplimentRoom: async (
        _,
        { roomId, assigneeName, note },
        context,
      ) => {
        assertAdminOrManager(context);
        const room = await loadRoomOrThrow(
          prisma,
          context,
          roomId,
          tenantHotelReadMatches,
        );
        const rawNotes = String(room.notes || "");
        if (!rawNotes.startsWith("COMPLIMENT|")) {
          throw new Error("This room is not a complimentary staff assignment");
        }
        const assignee = String(assigneeName ?? "").trim();
        if (!assignee) throw new Error("Assignee name is required");
        const rest = rawNotes.slice("COMPLIMENT|".length);
        const parts = rest.split("|");
        const prevAssignedBy = String(parts[1] || "").trim() || "Manager";
        const prevAssignedAt =
          String(parts[2] || "").trim() || new Date().toISOString();
        const { actorName, actorRole } = actorFromContext(context);
        const noteText = String(note ?? "").trim().replace(/\|/g, "/");
        const notes = `COMPLIMENT|${assignee}|${prevAssignedBy}|${prevAssignedAt}|${noteText}`;
        const updated = await prisma.lodging_room.update({
          where: { id: room.id },
          data: {
            status: "blocked",
            notes,
            maintenanceUntil: null,
            statusExpectedEndAt: null,
            updatedBy: actorName,
          },
        });
        await logLodgingAction(prisma, {
          HotelName: room.HotelName,
          actorRole,
          actorName,
          action: "update_compliment_room",
          entityType: "lodging_room",
          entityId: room.id,
          detail: {
            roomNumber: room.roomNumber,
            assignee,
            note: noteText,
          },
        });
        return updated;
      },

      releaseLodgingComplimentRoom: async (_, { roomId }, context) => {
        assertAdminOrManager(context);
        const room = await loadRoomOrThrow(
          prisma,
          context,
          roomId,
          tenantHotelReadMatches,
        );
        if (!String(room.notes || "").startsWith("COMPLIMENT|")) {
          throw new Error("This room is not a complimentary staff assignment");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const updated = await prisma.lodging_room.update({
          where: { id: room.id },
          data: {
            status: "vacant_clean",
            notes: "",
            maintenanceUntil: null,
            statusExpectedEndAt: null,
            updatedBy: actorName,
          },
        });
        await logLodgingAction(prisma, {
          HotelName: room.HotelName,
          actorRole,
          actorName,
          action: "release_compliment_room",
          entityType: "lodging_room",
          entityId: room.id,
          detail: { roomNumber: room.roomNumber },
        });
        return updated;
      },

      createLodgingCmAssignments: async (
        _,
        { roomId, workKind, assigneeNames, notes, statusExpectedEndAt },
        context,
      ) => {
        await assertCmPortal(context);
        const room = await loadRoomOrThrow(
          prisma,
          context,
          roomId,
          tenantHotelReadMatches,
        );
        const wk = String(workKind).trim();
        if (!CM_WORK_KINDS.has(wk)) throw new Error("Invalid workKind");
        const names = Array.isArray(assigneeNames)
          ? [
              ...new Set(
                assigneeNames
                  .map((n) => String(n ?? "").trim())
                  .filter(Boolean),
              ),
            ]
          : [];
        if (names.length === 0) {
          throw new Error("At least one assignee is required");
        }
        if (wk === "maintenance" && room.status === "occupied") {
          throw new Error("Occupied rooms cannot enter maintenance");
        }
        if (wk === "cleaning" && room.status !== "vacant_dirty") {
          throw new Error("Cleaning can only be assigned on vacant dirty rooms");
        }
        if (wk === "cleaning") {
          const existingOpen = await prisma.lodging_cm_assignment.count({
            where: {
              roomId: room.id,
              workKind: "cleaning",
              status: "open",
            },
          });
          if (existingOpen > 0) {
            throw new Error(
              "This room already has open cleaners — edit people instead of assigning again",
            );
          }
        }

        const { actorName, actorRole } = actorFromContext(context);
        const note = String(notes ?? "").trim();

        const createdIds = [];
        for (const assignee of names) {
          const row = await prisma.lodging_cm_assignment.create({
            data: {
              HotelName: room.HotelName,
              roomId: room.id,
              workKind: wk,
              assigneeName: assignee,
              notes: note,
              status: "open",
              assignedBy: actorName,
            },
          });
          createdIds.push(row.id);
        }

        if (wk === "maintenance") {
          const endAt =
            statusExpectedEndAt != null
              ? new Date(statusExpectedEndAt)
              : null;
          await prisma.lodging_room.update({
            where: { id: room.id },
            data: {
              status: "on_maintenance",
              maintenanceUntil:
                endAt && !Number.isNaN(endAt.getTime()) ? endAt : null,
              statusExpectedEndAt:
                endAt && !Number.isNaN(endAt.getTime()) ? endAt : null,
              updatedBy: actorName,
            },
          });
        } else if (wk === "cleaning" && statusExpectedEndAt != null) {
          const endAt = new Date(statusExpectedEndAt);
          if (!Number.isNaN(endAt.getTime())) {
            await prisma.lodging_room.update({
              where: { id: room.id },
              data: {
                statusExpectedEndAt: endAt,
                updatedBy: actorName,
              },
            });
          }
        }

        await logLodgingAction(prisma, {
          HotelName: room.HotelName,
          actorRole,
          actorName,
          action: "create_cm_assignments",
          entityType: "lodging_cm_assignment",
          entityId: createdIds[0] ?? null,
          detail: {
            roomId: room.id,
            workKind: wk,
            assigneeNames: names,
            count: names.length,
          },
        });

        return prisma.lodging_cm_assignment.findMany({
          where: { id: { in: createdIds } },
          include: { room: true },
        });
      },

      updateLodgingCmAssignment: async (
        _,
        { id, assigneeName, notes, statusExpectedEndAt },
        context,
      ) => {
        await assertCmPortal(context);
        const row = await prisma.lodging_cm_assignment.findUnique({
          where: { id: Number(id) },
          include: { room: true },
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("CM assignment not found");
        }
        if (row.status !== "open") {
          throw new Error("Only open assignments can be edited");
        }
        const roomStatus = String(row.room?.status || "").toLowerCase();
        const workKind = String(row.workKind || "").toLowerCase();
        if (workKind === "cleaning" && roomStatus !== "vacant_dirty") {
          throw new Error(
            "Cleaning assignments can only be edited while the room is vacant dirty",
          );
        }
        if (workKind === "maintenance" && roomStatus !== "on_maintenance") {
          throw new Error(
            "Maintenance assignments can only be edited while the room is on maintenance",
          );
        }

        const { actorName, actorRole } = actorFromContext(context);
        const data = {};
        if (assigneeName != null) {
          const name = String(assigneeName).trim();
          if (!name) throw new Error("Assignee name is required");
          data.assigneeName = name;
        }
        if (notes != null) {
          data.notes = String(notes).trim();
        }

        const updated = await prisma.lodging_cm_assignment.update({
          where: { id: row.id },
          data,
        });

        if (statusExpectedEndAt !== undefined) {
          const endAt =
            statusExpectedEndAt == null || statusExpectedEndAt === ""
              ? null
              : new Date(statusExpectedEndAt);
          if (endAt && Number.isNaN(endAt.getTime())) {
            throw new Error("Invalid expected ready date");
          }
          await prisma.lodging_room.update({
            where: { id: row.roomId },
            data: {
              statusExpectedEndAt: endAt,
              ...(workKind === "maintenance"
                ? { maintenanceUntil: endAt }
                : {}),
              updatedBy: actorName,
            },
          });
        }

        await logLodgingAction(prisma, {
          HotelName: row.HotelName,
          actorRole,
          actorName,
          action: "update_cm_assignment",
          entityType: "lodging_cm_assignment",
          entityId: row.id,
          detail: {
            roomId: row.roomId,
            workKind: row.workKind,
            assigneeName: data.assigneeName ?? row.assigneeName,
            statusExpectedEndAt:
              statusExpectedEndAt === undefined
                ? undefined
                : statusExpectedEndAt == null || statusExpectedEndAt === ""
                  ? null
                  : String(statusExpectedEndAt),
          },
        });

        return prisma.lodging_cm_assignment.findUnique({
          where: { id: updated.id },
          include: { room: true },
        });
      },

      syncLodgingCmOpenAssignees: async (
        _,
        { roomId, workKind, assigneeNames, notes, statusExpectedEndAt },
        context,
      ) => {
        await assertCmPortal(context);
        const room = await loadRoomOrThrow(
          prisma,
          context,
          roomId,
          tenantHotelReadMatches,
        );
        const wk = String(workKind || "").trim().toLowerCase();
        if (!CM_WORK_KINDS.has(wk)) throw new Error("Invalid workKind");
        const roomStatus = String(room.status || "").toLowerCase();
        if (wk === "cleaning" && roomStatus !== "vacant_dirty") {
          throw new Error(
            "Cleaning assignees can only be edited while the room is vacant dirty",
          );
        }
        if (wk === "maintenance" && roomStatus !== "on_maintenance") {
          throw new Error(
            "Maintenance assignees can only be edited while the room is on maintenance",
          );
        }

        const desired = Array.isArray(assigneeNames)
          ? [
              ...new Set(
                assigneeNames
                  .map((n) => String(n ?? "").trim())
                  .filter(Boolean),
              ),
            ]
          : [];
        if (desired.length === 0) {
          throw new Error("At least one assignee is required");
        }

        const openRows = await prisma.lodging_cm_assignment.findMany({
          where: {
            roomId: room.id,
            workKind: wk,
            status: "open",
            HotelName: room.HotelName,
          },
          orderBy: { id: "asc" },
        });
        if (openRows.length === 0) {
          throw new Error("No open assignments to edit for this room");
        }

        const { actorName, actorRole } = actorFromContext(context);
        const note =
          notes != null ? String(notes).trim() : openRows[0]?.notes || "";
        const desiredKey = new Map(
          desired.map((n) => [n.toLowerCase(), n]),
        );
        const keptIds = [];
        const cancelledNames = [];
        const addedNames = [];

        for (const row of openRows) {
          const key = String(row.assigneeName || "")
            .trim()
            .toLowerCase();
          if (desiredKey.has(key)) {
            const canonical = desiredKey.get(key);
            const data = {};
            if (canonical && canonical !== row.assigneeName) {
              data.assigneeName = canonical;
            }
            if (notes != null && note !== row.notes) {
              data.notes = note;
            }
            if (Object.keys(data).length > 0) {
              await prisma.lodging_cm_assignment.update({
                where: { id: row.id },
                data,
              });
            }
            keptIds.push(row.id);
            desiredKey.delete(key);
          } else {
            await prisma.lodging_cm_assignment.update({
              where: { id: row.id },
              data: {
                status: "cancelled",
                completedBy: actorName,
                completedAt: new Date(),
              },
            });
            cancelledNames.push(row.assigneeName);
          }
        }

        for (const name of desiredKey.values()) {
          const created = await prisma.lodging_cm_assignment.create({
            data: {
              HotelName: room.HotelName,
              roomId: room.id,
              workKind: wk,
              assigneeName: name,
              notes: note,
              status: "open",
              assignedBy: actorName,
            },
          });
          keptIds.push(created.id);
          addedNames.push(name);
        }

        if (statusExpectedEndAt !== undefined) {
          const endAt =
            statusExpectedEndAt == null || statusExpectedEndAt === ""
              ? null
              : new Date(statusExpectedEndAt);
          if (endAt && Number.isNaN(endAt.getTime())) {
            throw new Error("Invalid expected ready date");
          }
          await prisma.lodging_room.update({
            where: { id: room.id },
            data: {
              statusExpectedEndAt: endAt,
              ...(wk === "maintenance" ? { maintenanceUntil: endAt } : {}),
              updatedBy: actorName,
            },
          });
        }

        await logLodgingAction(prisma, {
          HotelName: room.HotelName,
          actorRole,
          actorName,
          action: "sync_cm_open_assignees",
          entityType: "lodging_room",
          entityId: room.id,
          detail: {
            roomId: room.id,
            workKind: wk,
            assigneeNames: desired,
            addedNames,
            cancelledNames,
            statusExpectedEndAt:
              statusExpectedEndAt === undefined
                ? undefined
                : statusExpectedEndAt == null || statusExpectedEndAt === ""
                  ? null
                  : String(statusExpectedEndAt),
          },
        });

        return prisma.lodging_cm_assignment.findMany({
          where: { id: { in: keptIds }, status: "open" },
          include: { room: true },
          orderBy: { id: "asc" },
        });
      },

      completeLodgingCmAssignment: async (_, { id }, context) => {
        await assertCmPortal(context);
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
        let roomCleared = false;

        await prisma.$transaction(async (tx) => {
          await tx.lodging_cm_assignment.update({
            where: { id: row.id },
            data: {
              status: "done",
              completedBy: actorName,
              completedAt: new Date(),
            },
          });

          const workKind = String(row.workKind || "").toLowerCase();
          const roomStatus = String(row.room?.status || "").toLowerCase();

          // Last finished cleaning job on a dirty room → inspected (CMLeader then vacant_clean).
          if (workKind === "cleaning" && roomStatus === "vacant_dirty") {
            const remaining = await tx.lodging_cm_assignment.count({
              where: {
                roomId: row.roomId,
                workKind: "cleaning",
                status: "open",
                NOT: { id: row.id },
              },
            });
            if (remaining === 0) {
              await tx.lodging_room.update({
                where: { id: row.roomId },
                data: {
                  status: "inspected",
                  maintenanceUntil: null,
                  statusExpectedEndAt: null,
                  updatedBy: actorName,
                },
              });
              roomCleared = true;
            }
          }

          // Last finished maintenance job → inspected (ready to open vacant clean).
          // Do not return to vacant_dirty — that reopens Enter maintenance as if
          // maintenance never finished.
          if (workKind === "maintenance" && roomStatus === "on_maintenance") {
            const remaining = await tx.lodging_cm_assignment.count({
              where: {
                roomId: row.roomId,
                workKind: "maintenance",
                status: "open",
                NOT: { id: row.id },
              },
            });
            if (remaining === 0) {
              await tx.lodging_room.update({
                where: { id: row.roomId },
                data: {
                  status: "inspected",
                  maintenanceUntil: null,
                  statusExpectedEndAt: null,
                  updatedBy: actorName,
                },
              });
              roomCleared = true;
            }
          }
        });

        await logLodgingAction(prisma, {
          HotelName: row.HotelName,
          actorRole,
          actorName,
          action: "complete_cm_assignment",
          entityType: "lodging_cm_assignment",
          entityId: row.id,
          detail: {
            workKind: row.workKind,
            roomId: row.roomId,
            roomAdvanced: roomCleared,
          },
        });

        return prisma.lodging_cm_assignment.findUnique({
          where: { id: row.id },
          include: { room: true },
        });
      },

      transferLodgingStayRoom: async (
        _,
        {
          stayId,
          fromRoomId,
          toRoomId,
          reason,
          markOldOnMaintenance,
          maintenanceUntil,
        },
        context,
      ) => {
        assertReceptionOrManager(context);
        const stay = await loadStayOrThrow(
          prisma,
          context,
          stayId,
          tenantHotelReadMatches,
        );
        if (stay.status !== "checked_in") {
          throw new Error("Only in-house stays can transfer rooms");
        }
        const fromId = Number(fromRoomId);
        const toId = Number(toRoomId);
        if (!(fromId > 0) || !(toId > 0) || fromId === toId) {
          throw new Error("Invalid room transfer");
        }
        const fromLink = (stay.rooms || []).find((r) => r.roomId === fromId);
        if (!fromLink) throw new Error("Guest is not in the source room");
        const toRoom = await loadRoomOrThrow(
          prisma,
          context,
          toId,
          tenantHotelReadMatches,
        );
        if (toRoom.HotelName !== stay.HotelName) {
          throw new Error("Target room is not in this property");
        }
        if (toRoom.status !== "vacant_clean") {
          throw new Error("Target room must be vacant and clean");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const fromRoomNumber = fromLink.room?.roomNumber || "";
        const toRoomNumber = toRoom.roomNumber;

        await prisma.$transaction(async (tx) => {
          await tx.lodging_stay_room.delete({
            where: { id: fromLink.id },
          });
          await tx.lodging_stay_room.create({
            data: {
              stayId: stay.id,
              roomId: toRoom.id,
              roomType: toRoom.roomType,
            },
          });

          const oldStatus = markOldOnMaintenance
            ? "on_maintenance"
            : "vacant_dirty";
          const endAt =
            maintenanceUntil != null ? new Date(maintenanceUntil) : null;
          await tx.lodging_room.update({
            where: { id: fromId },
            data: {
              status: oldStatus,
              maintenanceUntil:
                oldStatus === "on_maintenance" &&
                endAt &&
                !Number.isNaN(endAt.getTime())
                  ? endAt
                  : null,
              statusExpectedEndAt:
                endAt && !Number.isNaN(endAt.getTime()) ? endAt : null,
              updatedBy: actorName,
            },
          });
          await tx.lodging_room.update({
            where: { id: toId },
            data: {
              status: "occupied",
              maintenanceUntil: null,
              statusExpectedEndAt: null,
              updatedBy: actorName,
            },
          });

          if (stay.bill) {
            const lines = await tx.lodging_bill_line.findMany({
              where: { billId: stay.bill.id, voided: false },
            });
            for (const line of lines) {
              const kind = String(line.kind || "").toLowerCase();
              if (kind === "room") {
                // Repoint room night charge description/number to new room
                if (
                  line.roomNumber === fromRoomNumber ||
                  String(line.description || "").includes(fromRoomNumber)
                ) {
                  await tx.lodging_bill_line.update({
                    where: { id: line.id },
                    data: {
                      roomNumber: toRoomNumber,
                      description: String(line.description || "").split(fromRoomNumber).join(
                        toRoomNumber,
                      ),
                      unitPriceETB: Number(toRoom.pricePerNightETB) || line.unitPriceETB,
                      amountETB:
                        (Number(toRoom.pricePerNightETB) || line.unitPriceETB) *
                        Number(line.quantity || 1),
                    },
                  });
                }
              } else {
                // Service lines (café/laundry/other) move with guest to new room number
                if (
                  !line.roomNumber ||
                  line.roomNumber === fromRoomNumber ||
                  line.roomNumber === ""
                ) {
                  await tx.lodging_bill_line.update({
                    where: { id: line.id },
                    data: { roomNumber: toRoomNumber },
                  });
                }
              }
            }
            await recalcBillTotal(tx, stay.bill.id);
          }

          // Move open café room-service orders to same stay table (stay id unchanged)
          // but refresh captions if needed — tableNo is stay-based so orders already follow stay.
        });

        await logLodgingAction(prisma, {
          HotelName: stay.HotelName,
          actorRole,
          actorName,
          action: "transfer_stay_room",
          entityType: "lodging_stay",
          entityId: stay.id,
          stayId: stay.id,
          detail: {
            fromRoomId: fromId,
            toRoomId: toId,
            fromRoomNumber,
            toRoomNumber,
            reason: String(reason ?? "").trim(),
            markOldOnMaintenance: !!markOldOnMaintenance,
          },
        });

        return prisma.lodging_stay.findUnique({
          where: { id: stay.id },
          include: STAY_INCLUDE,
        });
      },

      voidLodgingBillLine: async (_, { lineId, reason }, context) => {
        assertAdminOrManager(context);
        const line = await prisma.lodging_bill_line.findUnique({
          where: { id: Number(lineId) },
          include: { bill: true },
        });
        if (!line || !tenantHotelReadMatches(context, line.bill.HotelName)) {
          throw new Error("Bill line not found");
        }
        if (line.bill.status !== "open") throw new Error("Bill is not open");
        if (line.voided) throw new Error("Line already voided");
        const why = String(reason ?? "").trim();
        if (!why) throw new Error("Void reason is required");
        const { actorName, actorRole } = actorFromContext(context);
        const updated = await prisma.lodging_bill_line.update({
          where: { id: line.id },
          data: {
            voided: true,
            voidedAt: new Date(),
            voidedBy: actorName,
            voidReason: why,
            fulfillmentStatus:
              String(line.kind).toLowerCase() === "laundry" ||
              String(line.kind).toLowerCase() === "food_drink"
                ? "cancelled"
                : line.fulfillmentStatus,
          },
        });
        await recalcBillTotal(prisma, line.billId);
        await logLodgingAction(prisma, {
          HotelName: line.bill.HotelName,
          actorRole,
          actorName,
          action: "void_bill_line",
          entityType: "lodging_bill_line",
          entityId: line.id,
          stayId: line.bill.stayId,
          detail: { reason: why },
        });
        return updated;
      },

      voidLodgingBill: async (_, { billId, reason }, context) => {
        assertAdminOrManager(context);
        const bill = await prisma.lodging_bill.findUnique({
          where: { id: Number(billId) },
          include: { lines: true },
        });
        if (!bill || !tenantHotelReadMatches(context, bill.HotelName)) {
          throw new Error("Bill not found");
        }
        if (bill.status === "void") throw new Error("Bill already voided");
        if (bill.status === "settled") {
          throw new Error("Settled bills cannot be voided");
        }
        const why = String(reason ?? "").trim();
        if (!why) throw new Error("Void reason is required");
        const { actorName, actorRole } = actorFromContext(context);
        const now = new Date();
        await prisma.$transaction(async (tx) => {
          for (const line of bill.lines) {
            if (line.voided) continue;
            const kind = String(line.kind || "").toLowerCase();
            const isService = kind === "laundry" || kind === "food_drink";
            await tx.lodging_bill_line.update({
              where: { id: line.id },
              data: {
                voided: true,
                voidedAt: now,
                voidedBy: actorName,
                voidReason: why,
                amountETB: 0,
                taxETB: 0,
                // Clear fulfillment gates so checkout can free rooms after folio void.
                ...(isService
                  ? {
                      fulfillmentStatus: "cancelled",
                      fulfilledAt: now,
                      fulfilledBy: actorName,
                    }
                  : {}),
              },
            });
          }
          await tx.lodging_bill.update({
            where: { id: bill.id },
            data: { status: "void", totalETB: 0 },
          });
        });

        // Cancel unpaid room-service café tickets linked to this stay.
        const roomServiceTable = ROOM_SERVICE_TABLE_BASE + Number(bill.stayId);
        const cafeOrders = await prisma.order.findMany({
          where: {
            HotelName: bill.HotelName,
            tableNo: roomServiceTable,
          },
          select: { id: true, payment: true, status: true },
        });
        const cancelIds = cafeOrders
          .filter((o) => {
            const payment = String(o.payment || "").toLowerCase();
            const status = String(o.status || "").toLowerCase();
            return payment !== "paid" && status !== "cancelled";
          })
          .map((o) => o.id);
        if (cancelIds.length > 0) {
          await prisma.order.updateMany({
            where: { id: { in: cancelIds } },
            data: {
              status: "Cancelled",
              cancelledBy: actorName || "Manager",
            },
          });
        }
        await logLodgingAction(prisma, {
          HotelName: bill.HotelName,
          actorRole,
          actorName,
          action: "void_bill",
          entityType: "lodging_bill",
          entityId: bill.id,
          stayId: bill.stayId,
          detail: { reason: why },
        });
        return prisma.lodging_bill.findUnique({
          where: { id: bill.id },
          include: { lines: true },
        });
      },

      voidLodgingRoomCharges: async (
        _,
        { stayId, roomNumber, reason },
        context,
      ) => {
        assertAdminOrManager(context);
        const stay = await prisma.lodging_stay.findUnique({
          where: { id: Number(stayId) },
          include: { bill: { include: { lines: true } } },
        });
        if (!stay || !tenantHotelReadMatches(context, stay.HotelName)) {
          throw new Error("Stay not found");
        }
        const rn = String(roomNumber ?? "").trim();
        if (!rn) throw new Error("roomNumber is required");
        const why = String(reason ?? "").trim();
        if (!why) throw new Error("Void reason is required");
        if (!stay.bill || stay.bill.status !== "open") {
          throw new Error("Stay has no open bill");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const now = new Date();
        let voided = 0;
        for (const line of stay.bill.lines) {
          if (line.voided) continue;
          if (String(line.roomNumber || "").trim() !== rn) continue;
          const kind = String(line.kind || "").toLowerCase();
          const isService = kind === "laundry" || kind === "food_drink";
          await prisma.lodging_bill_line.update({
            where: { id: line.id },
            data: {
              voided: true,
              voidedAt: now,
              voidedBy: actorName,
              voidReason: why,
              amountETB: 0,
              taxETB: 0,
              ...(isService
                ? {
                    fulfillmentStatus: "cancelled",
                    fulfilledAt: now,
                    fulfilledBy: actorName,
                  }
                : {}),
            },
          });
          voided += 1;
        }
        if (voided === 0) {
          throw new Error(`No open charges for room ${rn}`);
        }
        await recalcBillTotal(prisma, stay.bill.id);
        await logLodgingAction(prisma, {
          HotelName: stay.HotelName,
          actorRole,
          actorName,
          action: "void_room_charges",
          entityType: "lodging_stay",
          entityId: stay.id,
          stayId: stay.id,
          detail: { roomNumber: rn, reason: why, voided },
        });
        return prisma.lodging_stay.findUnique({
          where: { id: stay.id },
          include: STAY_INCLUDE,
        });
      },

      requestLodgingDiscount: async (
        _,
        { stayId, amountETB, reason },
        context,
      ) => {
        assertReceptionOrManager(context);
        const stay = await prisma.lodging_stay.findUnique({
          where: { id: Number(stayId) },
          include: { bill: true, rooms: { include: { room: true } } },
        });
        if (!stay || !tenantHotelReadMatches(context, stay.HotelName)) {
          throw new Error("Stay not found");
        }
        if (stay.status !== "checked_in") {
          throw new Error("Discount only allowed on checked-in stays");
        }
        const amt = Math.round(Number(amountETB) * 100) / 100;
        if (!Number.isFinite(amt) || amt <= 0) {
          throw new Error("Discount amount must be greater than zero");
        }
        const why = String(reason ?? "").trim();
        if (!why) throw new Error("Discount reason is required");

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

        const role = String(
          context.user?.Role ?? context.user?.role ?? "",
        )
          .trim()
          .toLowerCase();
        const isManager = role === "manager" || role === "admin";
        const { actorName, actorRole } = actorFromContext(context);
        const roomNumber = stay.rooms?.[0]?.room?.roomNumber || "";

        const line = await prisma.lodging_bill_line.create({
          data: {
            billId: bill.id,
            kind: "discount",
            description: why,
            quantity: 1,
            unitPriceETB: amt,
            amountETB: isManager ? -amt : 0,
            taxPercent: 0,
            taxETB: 0,
            roomNumber: String(roomNumber || ""),
            fulfillmentStatus: "completed",
            approvalStatus: isManager ? "approved" : "pending",
            approvedBy: isManager ? actorName : "",
            approvedAt: isManager ? new Date() : null,
            approvalNote: isManager ? "Applied by manager" : "",
            createdBy: actorName,
          },
        });
        await recalcBillTotal(prisma, bill.id);
        await logLodgingAction(prisma, {
          HotelName: stay.HotelName,
          actorRole,
          actorName,
          action: isManager ? "apply_discount" : "request_discount",
          entityType: "lodging_bill_line",
          entityId: line.id,
          stayId: stay.id,
          detail: { amountETB: amt, reason: why, autoApproved: isManager },
        });
        return line;
      },

      resolveLodgingDiscount: async (
        _,
        { lineId, approve, note },
        context,
      ) => {
        assertAdminOrManager(context);
        const line = await prisma.lodging_bill_line.findUnique({
          where: { id: Number(lineId) },
          include: { bill: true },
        });
        if (!line || !tenantHotelReadMatches(context, line.bill.HotelName)) {
          throw new Error("Discount line not found");
        }
        if (String(line.kind).toLowerCase() !== "discount") {
          throw new Error("Not a discount line");
        }
        if (line.voided) throw new Error("Line already voided");
        if (String(line.approvalStatus || "").toLowerCase() !== "pending") {
          throw new Error("Discount is not pending approval");
        }
        if (line.bill.status !== "open") throw new Error("Bill is not open");

        const { actorName, actorRole } = actorFromContext(context);
        const ok = Boolean(approve);
        const amt = Math.abs(Number(line.unitPriceETB) || 0);
        const updated = await prisma.lodging_bill_line.update({
          where: { id: line.id },
          data: {
            approvalStatus: ok ? "approved" : "rejected",
            approvedBy: actorName,
            approvedAt: new Date(),
            approvalNote: String(note ?? "").trim(),
            amountETB: ok ? -amt : 0,
            taxETB: 0,
            // Keep rejected discounts visible on the folio with the note (do not void).
            voided: false,
            voidedAt: null,
            voidedBy: "",
            voidReason: "",
          },
        });
        await recalcBillTotal(prisma, line.billId);
        await logLodgingAction(prisma, {
          HotelName: line.bill.HotelName,
          actorRole,
          actorName,
          action: ok ? "approve_discount" : "reject_discount",
          entityType: "lodging_bill_line",
          entityId: line.id,
          stayId: line.bill.stayId,
          detail: { amountETB: amt, note: String(note ?? "").trim() },
        });
        return updated;
      },

      createLodgingReservation: async (
        _,
        {
          guestId,
          guestJson,
          source,
          status,
          arrivalAt,
          nights,
          adults,
          children,
          preferredRoomType,
          roomIds,
          depositETB,
          depositPaymentMethod,
          isCompany,
          companyName,
          companyTin,
          notes,
        },
        context,
      ) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName, actorRole } = actorFromContext(context);
        const src = String(source || "phone").trim();
        if (!RESERVATION_SOURCES.has(src)) throw new Error("Invalid source");
        let st = String(status || "tentative").trim();
        if (!RESERVATION_STATUSES.has(st) || st === "checked_in") {
          st = "tentative";
        }
        const nightsN = Math.max(1, Math.floor(Number(nights) || 1));
        const arrival = new Date(arrivalAt);
        if (Number.isNaN(arrival.getTime())) throw new Error("Invalid arrivalAt");
        const departureAt = addDays(arrival, nightsN);

        let guest = null;
        if (guestId != null) {
          guest = await prisma.lodging_guest.findUnique({
            where: { id: Number(guestId) },
          });
          if (!guest || !tenantHotelReadMatches(context, guest.HotelName)) {
            throw new Error("Guest not found");
          }
        } else if (guestJson) {
          const payload = parseGuestPayload(guestJson);
          if (payload) {
            const gData = guestDataFromInput(payload, HotelName);
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

        const ids = Array.isArray(roomIds)
          ? [...new Set(roomIds.map((x) => Number(x)).filter((n) => n > 0))]
          : [];
        const holdable = await findHoldableRooms(
          prisma,
          context,
          arrival,
          tenantHotelReadWhere,
          { nights: nightsN },
        );
        const holdableIds = new Set(holdable.map((r) => r.id));
        for (const id of ids) {
          if (!holdableIds.has(id)) {
            const room = await prisma.lodging_room.findUnique({
              where: { id },
            });
            if (!room || !tenantHotelReadMatches(context, room.HotelName)) {
              throw new Error(`Room ${id} is not holdable for this arrival date`);
            }
            const blocksByRoom = await loadRoomBlockingIntervals(
              prisma,
              context,
              [id],
              tenantHotelReadWhere,
              {},
            );
            const fit = evaluateRoomDateFit(
              room,
              arrival,
              nightsN,
              blocksByRoom.get(id) || [],
            );
            throw new Error(
              fit.message ||
                `Room ${room.roomNumber} is not holdable for this arrival and nights`,
            );
          }
        }

        const reservationCode = await generateReservationCode(
          prisma,
          HotelName,
          arrival,
        );

        const deposit = Math.max(0, Number(depositETB) || 0);
        const payMethod =
          deposit > 0
            ? normalizePaymentMethod(depositPaymentMethod) ||
              (() => {
                throw new Error("Deposit payment method is required");
              })()
            : normalizePaymentMethod(depositPaymentMethod || "");
        const company = normalizeCompanyFields({
          isCompany,
          companyName,
          companyTin,
        });

        const created = await prisma.$transaction(async (tx) => {
          const row = await tx.lodging_reservation.create({
            data: {
              HotelName,
              reservationCode,
              guestId: guest?.id ?? null,
              status: st,
              source: src,
              arrivalAt: arrival,
              departureAt,
              nights: nightsN,
              adults: Math.max(1, Number(adults) || 1),
              children: Math.max(0, Number(children) || 0),
              preferredRoomType: String(preferredRoomType ?? "").trim(),
              depositETB: deposit,
              depositPaymentMethod: payMethod,
              isCompany: company.isCompany,
              companyName: company.companyName,
              companyTin: company.companyTin,
              notes: String(notes ?? "").trim(),
              createdBy: actorName,
              updatedBy: actorName,
            },
          });
          for (const id of ids) {
            const room = holdable.find((r) => r.id === id);
            await tx.lodging_reservation_room.create({
              data: {
                reservationId: row.id,
                roomId: id,
                roomType: room?.roomType || "",
              },
            });
            // Mark reserved only when vacant; leave occupied/dirty as-is.
            if (room?.status === "vacant_clean" || room?.status === "inspected") {
              await tx.lodging_room.update({
                where: { id },
                data: { status: "reserved", updatedBy: actorName },
              });
            } else if (room?.status === "reserved") {
              // Already held by another date-range booking — keep reserved.
            }
          }
          if (!ids.length && preferredRoomType) {
            await tx.lodging_reservation_room.create({
              data: {
                reservationId: row.id,
                roomId: null,
                roomType: String(preferredRoomType).trim(),
              },
            });
          }
          return row;
        });

        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "create_reservation",
          entityType: "lodging_reservation",
          entityId: created.id,
          detail: { reservationCode, roomIds: ids, status: st, source: src },
        });

        return prisma.lodging_reservation.findUnique({
          where: { id: created.id },
          include: RESERVATION_INCLUDE,
        });
      },

      updateLodgingReservation: async (
        _,
        {
          id,
          status,
          source,
          arrivalAt,
          nights,
          adults,
          children,
          preferredRoomType,
          roomIds,
          depositETB,
          depositPaymentMethod,
          isCompany,
          companyName,
          companyTin,
          notes,
          guestId,
        },
        context,
      ) => {
        assertReceptionOrManager(context);
        const row = await prisma.lodging_reservation.findUnique({
          where: { id: Number(id) },
          include: { rooms: true },
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("Reservation not found");
        }
        if (row.status === "checked_in" || row.status === "cancelled") {
          throw new Error("Reservation cannot be updated");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const data = { updatedBy: actorName };
        if (status != null) {
          const s = String(status).trim();
          if (!RESERVATION_STATUSES.has(s) || s === "checked_in") {
            throw new Error("Invalid reservation status");
          }
          data.status = s;
        }
        if (source != null) {
          const src = String(source).trim();
          if (!RESERVATION_SOURCES.has(src)) throw new Error("Invalid source");
          data.source = src;
        }
        if (arrivalAt != null) {
          const a = new Date(arrivalAt);
          if (Number.isNaN(a.getTime())) throw new Error("Invalid arrivalAt");
          data.arrivalAt = a;
        }
        if (nights != null) {
          data.nights = Math.max(1, Math.floor(Number(nights) || 1));
        }
        if (data.arrivalAt || data.nights) {
          const arrival = data.arrivalAt || row.arrivalAt;
          const n = data.nights != null ? data.nights : row.nights;
          data.departureAt = addDays(arrival, n);
        }
        if (adults != null) data.adults = Math.max(1, Number(adults) || 1);
        if (children != null) data.children = Math.max(0, Number(children) || 0);
        if (preferredRoomType != null) {
          data.preferredRoomType = String(preferredRoomType).trim();
        }
        if (depositETB != null) {
          data.depositETB = Math.max(0, Number(depositETB) || 0);
        }
        if (depositPaymentMethod != null) {
          const nextDeposit =
            data.depositETB != null ? data.depositETB : row.depositETB;
          data.depositPaymentMethod =
            nextDeposit > 0
              ? normalizePaymentMethod(depositPaymentMethod) ||
                (() => {
                  throw new Error("Deposit payment method is required");
                })()
              : normalizePaymentMethod(depositPaymentMethod || "");
        }
        if (
          isCompany != null ||
          companyName != null ||
          companyTin != null
        ) {
          const company = normalizeCompanyFields({
            isCompany: isCompany != null ? isCompany : row.isCompany,
            companyName:
              companyName != null ? companyName : row.companyName,
            companyTin: companyTin != null ? companyTin : row.companyTin,
          });
          data.isCompany = company.isCompany;
          data.companyName = company.companyName;
          data.companyTin = company.companyTin;
        }
        if (notes != null) data.notes = String(notes).trim();
        if (guestId != null) data.guestId = Number(guestId);

        await prisma.$transaction(async (tx) => {
          await tx.lodging_reservation.update({
            where: { id: row.id },
            data,
          });
          if (Array.isArray(roomIds)) {
            const previousRoomIds = (row.rooms || [])
              .map((rr) => rr.roomId)
              .filter((id) => id != null && Number(id) > 0)
              .map(Number);
            await tx.lodging_reservation_room.deleteMany({
              where: { reservationId: row.id },
            });
            for (const rid of previousRoomIds) {
              await reconcileRoomHoldStatus(tx, rid, actorName);
            }
            const arrival = data.arrivalAt || row.arrivalAt;
            const nightsForHold = Math.max(
              1,
              Math.floor(
                Number(
                  data.nights != null ? data.nights : row.nights,
                ) || 1,
              ),
            );
            const holdable = await findHoldableRooms(
              prisma,
              context,
              arrival,
              tenantHotelReadWhere,
              { nights: nightsForHold, excludeReservationId: row.id },
            );
            const holdableIds = new Set(holdable.map((r) => r.id));
            const ids = [
              ...new Set(roomIds.map((x) => Number(x)).filter((n) => n > 0)),
            ];
            for (const rid of ids) {
              if (!holdableIds.has(rid)) {
                const room = await prisma.lodging_room.findUnique({
                  where: { id: rid },
                });
                if (!room) throw new Error(`Room ${rid} is not holdable`);
                const blocksByRoom = await loadRoomBlockingIntervals(
                  prisma,
                  context,
                  [rid],
                  tenantHotelReadWhere,
                  { excludeReservationId: row.id },
                );
                const fit = evaluateRoomDateFit(
                  room,
                  arrival,
                  nightsForHold,
                  blocksByRoom.get(rid) || [],
                );
                throw new Error(fit.message || `Room ${rid} is not holdable`);
              }
              const room = holdable.find((r) => r.id === rid);
              await tx.lodging_reservation_room.create({
                data: {
                  reservationId: row.id,
                  roomId: rid,
                  roomType: room?.roomType || "",
                },
              });
              if (
                room?.status === "vacant_clean" ||
                room?.status === "inspected"
              ) {
                await tx.lodging_room.update({
                  where: { id: rid },
                  data: { status: "reserved", updatedBy: actorName },
                });
              }
            }
          }
        });

        await logLodgingAction(prisma, {
          HotelName: row.HotelName,
          actorRole,
          actorName,
          action: "update_reservation",
          entityType: "lodging_reservation",
          entityId: row.id,
          detail: data,
        });

        return prisma.lodging_reservation.findUnique({
          where: { id: row.id },
          include: RESERVATION_INCLUDE,
        });
      },

      cancelLodgingReservation: async (_, { id, asNoShow }, context) => {
        assertReceptionOrManager(context);
        const row = await prisma.lodging_reservation.findUnique({
          where: { id: Number(id) },
          include: { rooms: true },
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("Reservation not found");
        }
        if (row.status === "checked_in") {
          throw new Error("Already checked in");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const next = asNoShow ? "no_show" : "cancelled";
        await prisma.$transaction(async (tx) => {
          await tx.lodging_reservation.update({
            where: { id: row.id },
            data: { status: next, updatedBy: actorName },
          });
          // Release held inventory so rooms can be reserved or checked in again.
          for (const rr of row.rooms || []) {
            if (!rr.roomId) continue;
            await reconcileRoomHoldStatus(tx, rr.roomId, actorName);
          }
        });
        await logLodgingAction(prisma, {
          HotelName: row.HotelName,
          actorRole,
          actorName,
          action: asNoShow ? "reservation_no_show" : "cancel_reservation",
          entityType: "lodging_reservation",
          entityId: row.id,
          detail: {
            status: next,
            releasedRoomIds: (row.rooms || [])
              .map((rr) => rr.roomId)
              .filter(Boolean),
          },
        });
        return prisma.lodging_reservation.findUnique({
          where: { id: row.id },
          include: RESERVATION_INCLUDE,
        });
      },

      checkInLodgingReservation: async (
        _,
        { reservationId, roomIds, arrivalAt, notes },
        context,
      ) => {
        assertReceptionOrManager(context);
        const row = await prisma.lodging_reservation.findUnique({
          where: { id: Number(reservationId) },
          include: RESERVATION_INCLUDE,
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("Reservation not found");
        }
        if (
          row.status === "cancelled" ||
          row.status === "no_show" ||
          row.status === "checked_in"
        ) {
          throw new Error("Reservation cannot be checked in");
        }
        const ids = Array.isArray(roomIds)
          ? [...new Set(roomIds.map((x) => Number(x)).filter((n) => n > 0))]
          : [];
        if (!ids.length) {
          throw new Error("Assign at least one vacant clean room");
        }
        const arrival = arrivalAt ? new Date(arrivalAt) : new Date();
        // Delegates to createLodgingStay (same Mutation map) via late-bound self.
        return selfMutation.createLodgingStay(
          _,
          {
            guestId: row.guestId,
            arrivalAt: arrival,
            nights: row.nights,
            adults: row.adults,
            children: row.children,
            preferredRoomType: row.preferredRoomType,
            roomIds: ids,
            notes: notes != null ? String(notes) : row.notes,
            status: "checked_in",
            reservationId: row.id,
          },
          context,
        );
      },

      upsertLodgingTaxConfig: async (
        _,
        { kind, name, taxPercent, id },
        context,
      ) => {
        assertAdminOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const k = String(kind || "").trim();
        if (!BILL_LINE_KINDS.has(k)) throw new Error("Invalid tax kind");
        const n = String(name || "").trim() || "Tax";
        const pct = Math.max(0, Number(taxPercent) || 0);
        const { actorName, actorRole } = actorFromContext(context);
        let row;
        if (id != null && Number(id) > 0) {
          const existing = await prisma.lodging_tax_config.findUnique({
            where: { id: Number(id) },
          });
          if (
            !existing ||
            !tenantHotelReadMatches(context, existing.HotelName)
          ) {
            throw new Error("Tax config not found");
          }
          row = await prisma.lodging_tax_config.update({
            where: { id: existing.id },
            data: {
              name: n,
              kind: k,
              taxPercent: pct,
              updatedBy: actorName,
            },
          });
        } else {
          row = await prisma.lodging_tax_config.upsert({
            where: {
              HotelName_kind_name: { HotelName, kind: k, name: n },
            },
            create: {
              HotelName,
              kind: k,
              name: n,
              taxPercent: pct,
              updatedBy: actorName,
            },
            update: { taxPercent: pct, updatedBy: actorName },
          });
        }
        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "upsert_tax_config",
          entityType: "lodging_tax_config",
          entityId: row.id,
          detail: { kind: k, name: n, taxPercent: pct },
        });
        return row;
      },

      deleteLodgingTaxConfig: async (_, { id }, context) => {
        assertAdminOrManager(context);
        const row = await prisma.lodging_tax_config.findUnique({
          where: { id: Number(id) },
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("Tax config not found");
        }
        const { actorName, actorRole } = actorFromContext(context);
        await prisma.lodging_tax_config.delete({ where: { id: row.id } });
        await logLodgingAction(prisma, {
          HotelName: row.HotelName,
          actorRole,
          actorName,
          action: "delete_tax_config",
          entityType: "lodging_tax_config",
          entityId: row.id,
          detail: { kind: row.kind, name: row.name },
        });
        return true;
      },

      addLodgingPenaltyLines: async (_, { stayId, linesJson, note }, context) => {
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
        let parsed;
        try {
          parsed = JSON.parse(String(linesJson || "[]"));
        } catch {
          throw new Error("Invalid penalty lines");
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error("Add at least one penalty line");
        }
        const noteText = String(note ?? "").trim();
        const { actorName, actorRole } = actorFromContext(context);
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

        const roomNumber =
          stay.rooms?.[0]?.room?.roomNumber ||
          stay.rooms?.[0]?.roomNumber ||
          "";

        for (const raw of parsed) {
          const name = String(raw?.name ?? raw?.description ?? "").trim();
          const amount = Math.max(0, Number(raw?.amountETB ?? raw?.amount) || 0);
          if (!name) throw new Error("Penalty name is required");
          if (!(amount > 0)) throw new Error("Penalty amount must be positive");
          const { taxPercent, taxETB, taxDetailJson } = await applyTaxToAmounts(
            prisma,
            stay.HotelName,
            "penalty",
            amount,
          );
          const desc = noteText
            ? `${name} · ${noteText}`
            : name;
          await prisma.lodging_bill_line.create({
            data: {
              billId: bill.id,
              kind: "penalty",
              description: desc,
              quantity: 1,
              unitPriceETB: amount,
              amountETB: amount,
              taxPercent,
              taxETB,
              taxDetailJson,
              roomNumber: String(roomNumber || "").trim(),
              fulfillmentStatus: "completed",
              fulfilledAt: new Date(),
              fulfilledBy: actorName,
              approvalStatus: "",
              createdBy: actorName,
            },
          });
        }
        await recalcBillTotal(prisma, bill.id);
        await logLodgingAction(prisma, {
          HotelName: stay.HotelName,
          actorRole,
          actorName,
          action: "add_penalty_lines",
          entityType: "lodging_stay",
          entityId: stay.id,
          stayId: stay.id,
          detail: { count: parsed.length, note: noteText },
        });
        return prisma.lodging_stay.findUnique({
          where: { id: stay.id },
          include: STAY_INCLUDE,
        });
      },

      openLodgingBusinessDay: async (
        _,
        { fromAt, toAt, label, businessDate },
        context,
      ) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const from = new Date(fromAt);
        const to = new Date(toAt);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
          throw new Error("Invalid fromAt or toAt");
        }
        if (to <= from) throw new Error("toAt must be after fromAt");
        const day = String(businessDate || "").trim() || ymdLocal(from);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          throw new Error("businessDate must be YYYY-MM-DD");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const row = await prisma.lodging_business_day.create({
          data: {
            HotelName,
            businessDate: day,
            label: String(label ?? "").trim(),
            fromAt: from,
            toAt: to,
            status: "open",
            summaryJson: "",
          },
        });
        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "open_business_day",
          entityType: "lodging_business_day",
          entityId: row.id,
          detail: {
            businessDate: day,
            fromAt: from.toISOString(),
            toAt: to.toISOString(),
          },
        });
        return row;
      },

      closeLodgingBusinessDay: async (
        _,
        { businessDate, fromAt, toAt, label, id, receptionistId },
        context,
      ) => {
        assertReceptionOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName, actorRole } = actorFromContext(context);

        let row = null;
        if (id != null) {
          row = await prisma.lodging_business_day.findUnique({
            where: { id: Number(id) },
          });
          if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
            throw new Error("Business day / shift not found");
          }
        }

        const from = fromAt
          ? new Date(fromAt)
          : row?.fromAt
            ? new Date(row.fromAt)
            : null;
        const to = toAt
          ? new Date(toAt)
          : row?.toAt
            ? new Date(row.toAt)
            : null;
        if (
          !from ||
          !to ||
          Number.isNaN(from.getTime()) ||
          Number.isNaN(to.getTime())
        ) {
          throw new Error("fromAt and toAt are required");
        }
        if (to <= from) throw new Error("toAt must be after fromAt");

        const day =
          String(businessDate || row?.businessDate || "").trim() || ymdLocal(from);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          throw new Error("businessDate must be YYYY-MM-DD");
        }
        if (row?.status === "closed") {
          throw new Error("This shift is already closed");
        }

        if (receptionistId == null) {
          throw new Error("Select a receptionist for this night audit close");
        }
        const receptionist = await prisma.lodging_receptionist.findFirst({
          where: {
            id: Number(receptionistId),
            HotelName,
            isActive: true,
          },
        });
        if (!receptionist) {
          throw new Error("Receptionist not found or inactive");
        }
        const scopedReceptionistId = receptionist.id;
        const receptionistName = receptionistDisplayName(receptionist);

        const [arrivals, departures, inHouse, noShows, openBills, roomRows, arrivalStays, departureStays, inHouseStays] =
          await Promise.all([
            prisma.lodging_stay.count({
              where: {
                HotelName,
                arrivalAt: { gte: from, lte: to },
                ...(receptionistName
                  ? { checkedInBy: receptionistName }
                  : {}),
              },
            }),
            prisma.lodging_stay.count({
              where: {
                HotelName,
                status: "checked_out",
                departureAt: { gte: from, lte: to },
                ...(receptionistName
                  ? { checkedOutBy: receptionistName }
                  : {}),
              },
            }),
            prisma.lodging_stay.count({
              where: {
                HotelName,
                status: "checked_in",
                ...(receptionistName
                  ? { checkedInBy: receptionistName }
                  : {}),
              },
            }),
            prisma.lodging_reservation.count({
              where: {
                HotelName,
                status: "no_show",
                arrivalAt: { gte: from, lte: to },
              },
            }),
            prisma.lodging_bill.aggregate({
              where: { HotelName, status: "open" },
              _sum: { totalETB: true },
            }),
            prisma.lodging_room.findMany({
              where: { HotelName },
              select: {
                id: true,
                roomNumber: true,
                roomType: true,
                floor: true,
                status: true,
              },
              orderBy: [{ floor: "asc" }, { roomNumber: "asc" }],
            }),
            prisma.lodging_stay.findMany({
              where: {
                HotelName,
                arrivalAt: { gte: from, lte: to },
                ...(receptionistName
                  ? { checkedInBy: receptionistName }
                  : {}),
              },
              include: {
                guest: { select: { firstName: true, lastName: true } },
                rooms: { include: { room: { select: { roomNumber: true } } } },
              },
              orderBy: { arrivalAt: "asc" },
            }),
            prisma.lodging_stay.findMany({
              where: {
                HotelName,
                status: "checked_out",
                departureAt: { gte: from, lte: to },
                ...(receptionistName
                  ? { checkedOutBy: receptionistName }
                  : {}),
              },
              include: {
                guest: { select: { firstName: true, lastName: true } },
                rooms: { include: { room: { select: { roomNumber: true } } } },
              },
              orderBy: { departureAt: "asc" },
            }),
            prisma.lodging_stay.findMany({
              where: {
                HotelName,
                status: "checked_in",
                ...(receptionistName
                  ? { checkedInBy: receptionistName }
                  : {}),
              },
              include: {
                guest: { select: { firstName: true, lastName: true } },
                rooms: { include: { room: { select: { roomNumber: true } } } },
              },
              orderBy: { arrivalAt: "asc" },
            }),
          ]);

        const guestName = (s) => {
          const g = s.guest;
          if (!g) return "Guest";
          return `${g.firstName || ""} ${g.lastName || ""}`.trim() || "Guest";
        };
        const stayRooms = (s) =>
          (s.rooms || [])
            .map((r) => r.room?.roomNumber)
            .filter(Boolean)
            .join(", ") || "—";

        const roomsByStatus = {};
        for (const r of roomRows) {
          const st = String(r.status || "unknown");
          roomsByStatus[st] = (roomsByStatus[st] || 0) + 1;
        }

        const summary = {
          arrivals,
          departures,
          inHouse,
          noShows,
          outstandingBalanceETB: Number(openBills._sum.totalETB || 0),
          fromAt: from.toISOString(),
          toAt: to.toISOString(),
          closedAt: new Date().toISOString(),
          receptionistId: scopedReceptionistId,
          receptionistName,
          roomsByStatus,
          rooms: roomRows.map((r) => ({
            roomNumber: r.roomNumber,
            roomType: r.roomType,
            floor: r.floor,
            status: r.status,
          })),
          arrivalRooms: arrivalStays.map((s) => ({
            voucherCode: s.voucherCode,
            guest: guestName(s),
            rooms: stayRooms(s),
            at: s.arrivalAt,
            by: s.checkedInBy || "",
          })),
          departureRooms: departureStays.map((s) => ({
            voucherCode: s.voucherCode,
            guest: guestName(s),
            rooms: stayRooms(s),
            at: s.departureAt,
            by: s.checkedOutBy || "",
          })),
          inHouseRooms: inHouseStays.map((s) => ({
            voucherCode: s.voucherCode,
            guest: guestName(s),
            rooms: stayRooms(s),
            arrivalAt: s.arrivalAt,
            by: s.checkedInBy || "",
          })),
        };

        if (row) {
          row = await prisma.lodging_business_day.update({
            where: { id: row.id },
            data: {
              businessDate: day,
              label: label != null ? String(label).trim() : row.label,
              fromAt: from,
              toAt: to,
              status: "closed",
              closedAt: new Date(),
              closedBy: actorName,
              receptionistId: scopedReceptionistId,
              receptionistName,
              summaryJson: JSON.stringify(summary),
            },
          });
        } else {
          row = await prisma.lodging_business_day.create({
            data: {
              HotelName,
              businessDate: day,
              label: String(label ?? "").trim(),
              fromAt: from,
              toAt: to,
              status: "closed",
              closedAt: new Date(),
              closedBy: actorName,
              receptionistId: scopedReceptionistId,
              receptionistName,
              summaryJson: JSON.stringify(summary),
            },
          });
        }
        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "close_business_day",
          entityType: "lodging_business_day",
          entityId: row.id,
          detail: summary,
        });
        return row;
      },

      createLodgingReceptionists: async (_, { linesJson }, context) => {
        assertAdminOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        let lines;
        try {
          lines = JSON.parse(String(linesJson || "[]"));
        } catch {
          throw new Error("Invalid receptionist lines");
        }
        if (!Array.isArray(lines) || lines.length === 0) {
          throw new Error("Add at least one receptionist line");
        }
        const created = [];
        for (const line of lines) {
          const firstName = String(line?.firstName ?? "").trim();
          const lastName = String(line?.lastName ?? "").trim();
          const password = String(line?.password ?? "");
          if (!firstName || !lastName) {
            throw new Error("First and last name are required");
          }
          if (password.length < 4) {
            throw new Error(
              `Password for ${firstName} ${lastName} must be at least 4 characters`,
            );
          }
          const passwordHash = await bcrypt.hash(password, 10);
          const row = await prisma.lodging_receptionist.create({
            data: {
              HotelName,
              firstName,
              lastName,
              passwordHash,
              isActive: true,
              updatedBy: actorName,
            },
          });
          created.push(row);
        }
        return created;
      },

      updateLodgingReceptionist: async (
        _,
        { id, firstName, lastName, password, isActive },
        context,
      ) => {
        assertAdminOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const { actorName } = actorFromContext(context);
        const existing = await prisma.lodging_receptionist.findUnique({
          where: { id: Number(id) },
        });
        if (!existing || existing.HotelName !== HotelName) {
          throw new Error("Receptionist not found");
        }
        const data = { updatedBy: actorName };
        if (firstName != null) data.firstName = String(firstName).trim();
        if (lastName != null) data.lastName = String(lastName).trim();
        if (isActive != null) data.isActive = Boolean(isActive);
        if (password != null && String(password).length > 0) {
          if (String(password).length < 4) {
            throw new Error("Password must be at least 4 characters");
          }
          data.passwordHash = await bcrypt.hash(String(password), 10);
        }
        if (!data.firstName && existing.firstName) {
          /* keep */
        }
        return prisma.lodging_receptionist.update({
          where: { id: existing.id },
          data,
        });
      },

      deleteLodgingReceptionist: async (_, { id }, context) => {
        assertAdminOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const existing = await prisma.lodging_receptionist.findUnique({
          where: { id: Number(id) },
        });
        if (!existing || existing.HotelName !== HotelName) {
          throw new Error("Receptionist not found");
        }
        await prisma.lodging_receptionist.delete({ where: { id: existing.id } });
        return true;
      },

      createLodgingRatePlan: async (
        _,
        {
          name,
          code,
          kind,
          roomType,
          pricePerNightETB,
          startDate,
          endDate,
          minNights,
          priority,
          isActive,
          notes,
        },
        context,
      ) => {
        assertAdminOrManager(context);
        const HotelName = requireTenant(context, tenantScopeFromContext);
        const k = String(kind || "standard").trim().toLowerCase();
        if (!RATE_PLAN_KINDS.has(k)) throw new Error("Invalid rate plan kind");
        const nm = String(name || "").trim();
        if (!nm) throw new Error("Name is required");
        const { actorName, actorRole } = actorFromContext(context);
        const row = await prisma.lodging_rate_plan.create({
          data: {
            HotelName,
            name: nm,
            code: String(code ?? "").trim(),
            kind: k,
            roomType: String(roomType ?? "").trim(),
            pricePerNightETB: Math.max(0, Number(pricePerNightETB) || 0),
            startDate: String(startDate ?? "").trim(),
            endDate: String(endDate ?? "").trim(),
            minNights: Math.max(1, Math.floor(Number(minNights) || 1)),
            priority: Math.floor(Number(priority) || 0),
            isActive: isActive !== false,
            notes: String(notes ?? "").trim(),
            updatedBy: actorName,
          },
        });
        await logLodgingAction(prisma, {
          HotelName,
          actorRole,
          actorName,
          action: "create_rate_plan",
          entityType: "lodging_rate_plan",
          entityId: row.id,
          detail: { name: nm, kind: k, pricePerNightETB: row.pricePerNightETB },
        });
        return row;
      },

      updateLodgingRatePlan: async (_, args, context) => {
        assertAdminOrManager(context);
        const row = await prisma.lodging_rate_plan.findUnique({
          where: { id: Number(args.id) },
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("Rate plan not found");
        }
        const data = { updatedBy: actorFromContext(context).actorName };
        if (args.name != null) data.name = String(args.name).trim();
        if (args.code != null) data.code = String(args.code).trim();
        if (args.kind != null) {
          const k = String(args.kind).trim().toLowerCase();
          if (!RATE_PLAN_KINDS.has(k)) throw new Error("Invalid rate plan kind");
          data.kind = k;
        }
        if (args.roomType != null) data.roomType = String(args.roomType).trim();
        if (args.pricePerNightETB != null) {
          data.pricePerNightETB = Math.max(0, Number(args.pricePerNightETB) || 0);
        }
        if (args.startDate != null) data.startDate = String(args.startDate).trim();
        if (args.endDate != null) data.endDate = String(args.endDate).trim();
        if (args.minNights != null) {
          data.minNights = Math.max(1, Math.floor(Number(args.minNights) || 1));
        }
        if (args.priority != null) data.priority = Math.floor(Number(args.priority) || 0);
        if (args.isActive != null) data.isActive = Boolean(args.isActive);
        if (args.notes != null) data.notes = String(args.notes).trim();
        const { actorName, actorRole } = actorFromContext(context);
        const updated = await prisma.lodging_rate_plan.update({
          where: { id: row.id },
          data,
        });
        await logLodgingAction(prisma, {
          HotelName: row.HotelName,
          actorRole,
          actorName,
          action: "update_rate_plan",
          entityType: "lodging_rate_plan",
          entityId: row.id,
          detail: data,
        });
        return updated;
      },

      deleteLodgingRatePlan: async (_, { id }, context) => {
        assertAdminOrManager(context);
        const row = await prisma.lodging_rate_plan.findUnique({
          where: { id: Number(id) },
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("Rate plan not found");
        }
        const { actorName, actorRole } = actorFromContext(context);
        await prisma.lodging_rate_plan.delete({ where: { id: row.id } });
        await logLodgingAction(prisma, {
          HotelName: row.HotelName,
          actorRole,
          actorName,
          action: "delete_rate_plan",
          entityType: "lodging_rate_plan",
          entityId: row.id,
          detail: { name: row.name },
        });
        return true;
      },

      updateLodgingGuestComplaint: async (_, { id, status }, context) => {
        assertReceptionOrManager(context);
        const row = await prisma.lodging_guest_complaint.findUnique({
          where: { id: Number(id) },
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("Complaint not found");
        }
        const next = String(status || "")
          .trim()
          .toLowerCase();
        if (!["open", "acknowledged", "resolved"].includes(next)) {
          throw new Error("Status must be open, acknowledged, or resolved");
        }
        const { actorName, actorRole } = actorFromContext(context);
        const updated = await prisma.lodging_guest_complaint.update({
          where: { id: row.id },
          data: { status: next },
          include: GUEST_FEEDBACK_INCLUDE,
        });
        await logLodgingAction(prisma, {
          HotelName: row.HotelName,
          actorRole,
          actorName,
          action: "update_guest_complaint",
          entityType: "lodging_guest_complaint",
          entityId: row.id,
          stayId: row.stayId,
          detail: { status: next },
        });
        return enrichGuestFeedbackRow(updated);
      },
    },
  };

  Object.assign(selfMutation, resolvers.Mutation);
  return resolvers;
}
