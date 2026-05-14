import express from "express";
import { ApolloServer, gql } from "apollo-server-express";
import cors from "cors";
import crypto from "crypto";
import { PrismaClient } from "./generated/prisma/index.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { DateTimeResolver, GraphQLJSON } from "graphql-scalars";

const prisma = new PrismaClient();
const JWT_Secret = process.env.JWT_Secret;
/** Default 14d — slow networks & regional users; override with JWT_EXPIRES_IN e.g. "30d". */
const JWT_EXPIRES_IN =
  process.env.JWT_EXPIRES_IN != null &&
  String(process.env.JWT_EXPIRES_IN).trim() !== ""
    ? String(process.env.JWT_EXPIRES_IN).trim()
    : "14d";

function isVatEnabled(flag) {
  if (flag === true) return true;
  if (typeof flag === "string") {
    const v = flag.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  }
  if (typeof flag === "number") return flag === 1;
  return false;
}

const INVENTORY_VAT_RATE = 0.15;

function computeInventoryVatETB(subtotal, purchaseWithVat) {
  if (!isVatEnabled(purchaseWithVat)) return 0;
  return Number(subtotal || 0) * INVENTORY_VAT_RATE;
}

function computeInventoryPaidAmountETB(amount, unitPrice, purchaseWithVat) {
  const qty = Number(amount) || 0;
  const price = Number(unitPrice) || 0;
  const subtotal = qty * price;
  if (!isVatEnabled(purchaseWithVat)) return subtotal;
  return subtotal + price * INVENTORY_VAT_RATE;
}

function computeInventoryTotalETB({
  amount,
  unitPrice,
  dutyFee,
  purchaseWithVat,
}) {
  const qty = Number(amount) || 0;
  const price = Number(unitPrice) || 0;
  const duty = Number(dutyFee) || 0;
  return computeInventoryPaidAmountETB(qty, price, purchaseWithVat) + duty;
}

/** Random tenant id when the business does not supply a 10-digit TIN (not guessable, URL-safe). */
function generateAutoTenantKey() {
  const slug = crypto.randomBytes(12).toString("base64url");
  return `TIN_${slug}`;
}

/**
 * Resolves tenant TIN for a **new** business (CreateAdmin).
 * Many `user` rows (staff) may share the same `tinNumber`; uniqueness is only
 * across businesses: no existing row may already use this tin for another org.
 * If the preferred value is not exactly 10 digits, assigns a random `TIN_*` string.
 */
async function allocateUniqueTinNumber(prismaClient, preferredTenDigitTin) {
  const tin = (preferredTenDigitTin || "").trim();
  if (/^\d{10}$/.test(tin)) {
    const taken = await prismaClient.user.findFirst({
      where: { tinNumber: tin },
    });
    if (taken) {
      throw new Error("This TIN is already registered to a business");
    }
    return tin;
  }
  for (let i = 0; i < 100; i++) {
    const key = generateAutoTenantKey();
    const taken = await prismaClient.user.findFirst({
      where: { tinNumber: key },
    });
    if (!taken) return key;
  }
  throw new Error("Could not allocate a unique business id");
}

/**
 * Value stored on Item/Order/… `HotelName` column.
 * JWT carries `tenantId` (tin or legacy tenant string); `HotelName` on JWT is display name only.
 */
function tenantScopeFromContext(ctx) {
  const u = ctx?.user;
  if (!u) return null;
  if (u.tenantId != null && String(u.tenantId).trim() !== "") {
    return String(u.tenantId).trim();
  }
  const t = u.tinNumber != null ? String(u.tinNumber).trim() : "";
  if (t) return t;
  if (u.HotelName) return String(u.HotelName).trim();
  return null;
}

/**
 * Item/Order/… rows may still use legacy display strings in `HotelName` while the JWT
 * scopes by `tenantId` (TIN). Reads must OR-match so lists are not empty mid-migration.
 */
function tenantHotelReadWhere(ctx) {
  const u = ctx?.user;
  if (!u) return { HotelName: "__no_user__" };
  const keys = new Set();
  const tid =
    u.tenantId != null && String(u.tenantId).trim() !== ""
      ? String(u.tenantId).trim()
      : "";
  const tin =
    u.tinNumber != null && String(u.tinNumber).trim() !== ""
      ? String(u.tinNumber).trim()
      : "";
  const disp =
    u.HotelName != null && String(u.HotelName).trim() !== ""
      ? String(u.HotelName).trim()
      : "";
  if (tid) keys.add(tid);
  if (tin) keys.add(tin);
  if (disp) keys.add(disp);
  const list = [...keys];
  if (list.length === 0) return { HotelName: "__no_scope__" };
  if (list.length === 1) return { HotelName: list[0] };
  return { OR: list.map((HotelName) => ({ HotelName })) };
}

function tenantHotelReadMatches(ctx, rowHotelName) {
  const u = ctx?.user;
  if (!u) return false;
  const row =
    rowHotelName != null && String(rowHotelName).trim() !== ""
      ? String(rowHotelName).trim()
      : "";
  if (!row) return false;
  const tid =
    u.tenantId != null && String(u.tenantId).trim() !== ""
      ? String(u.tenantId).trim()
      : "";
  const tin =
    u.tinNumber != null && String(u.tinNumber).trim() !== ""
      ? String(u.tinNumber).trim()
      : "";
  const disp =
    u.HotelName != null && String(u.HotelName).trim() !== ""
      ? String(u.HotelName).trim()
      : "";
  return row === tid || row === tin || row === disp;
}

/** Filter `user` rows in the same organization. */
function sameOrganizationWhere(ctx) {
  const u = ctx?.user;
  if (!u) return {};
  const t = u.tinNumber != null ? String(u.tinNumber).trim() : "";
  if (t) return { tinNumber: t };
  return { HotelName: u.HotelName };
}

const typeDefs = gql`
  scalar JSON
  scalar DateTime

  type User {
    id: Int!
    UserName: String!
    Password: String!
    HotelName: String!
    tinNumber: String
    businessType: String
    modules: JSON
    Role: String!
    LogoUrl: String
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type Item {
    id: Int!
    name: String!
    price: Float!
    HotelName: String!
    category: String!
    type: String!
    imageUrl: String!
    createdAt: DateTime!
  }

  type cashouts {
    id: Int!
    items: JSON
    prices: JSON
    measuredBy: JSON
    requiredAmount: JSON
    totalCalc: Float!
    HotelName: String!
    createdAt: DateTime!
  }

  type Order {
    id: Int!
    title: String!
    imageUrl: String!
    tableNo: Int!
    HotelName: String!
    orderAmount: Int!
    category: String!
    type: String!
    price: Float!
    waiterName: String!
    status: String
    payment: String
    withBank: Boolean
    credit: Boolean
    credittorName: String
    creditAmount: Float
    createdAt: DateTime!
  }

  input OrderInput {
    title: String!
    imageUrl: String!
    tableNo: Int!
    waiterName: String!
    orderAmount: Int!
    category: String!
    HotelName: String!
    type: String!
    price: Float!
    status: String
    credit: Boolean
    credittorName: String
    creditAmount: Float
    payment: String
  }

  type waiter {
    id: Int!
    name: String!
    HotelName: String!
    sex: String!
    age: Int!
    experience: Int!
    phoneNumber: String!
    price: JSON
    tablesServed: JSON
    payment: JSON
    incomeAt: JSON
    createdAt: DateTime!
  }

  type table {
    id: Int!
    tableNo: Int!
    HotelName: String!
    status: [String]
    price: JSON
    payment: JSON
    incomeAt: JSON
    capacity: Int!
    createdAt: DateTime!
  }

  type creditLevel {
    id: Int!
    level: String!
    requiredAmount: Float!
    timeInterval: Int!
    timeFrame: String!
    HotelName: String!
  }

  type pityCash {
    id: Int!
    amount: Float!
    startDate: DateTime!
    endDate: DateTime!
    HotelName: String!
  }

  type CreditRegistration {
    id: Int!
    name: String!
    imageUrl: String!
    sex: String!
    creditLevel: String!
    phoneNumber: String!
    amount: Float!
    timeInterval: Int!
    timeFrame: String!
    paidAmount: Float!
    registrationDate: DateTime!
    HotelName: String!
  }

  type ItemRegistration {
    id: Int!
    name: String!
    imageUrl: String!
    category: String!
    amount: Float!
    measuredBy: String!
    unitPrice: Float!
    registrationDate: DateTime!
    expireDate: DateTime!
    dutyFee: Float!
    supplierName: String!
    supplierPhone: String!
    Address: String!
    supplierLevel: String!
    purchaseWithVat: Boolean!
    supplierTinNumber: String!
    paidAmount: Float!
    registeredAmount: Float!
    registeredValue: Float!
    statusBy: String
    HotelName: String!
  }

  type ItemStatus {
    id: Int!
    name: String!
    imageUrl: String!
    category: String!
    amount: Float!
    measuredBy: String!
    unitPrice: Float!   
    actionDate: DateTime!
    supplierName: String!
    supplierPhone: String!   
    Address:       String!
    supplierLevel: String!
    purchaseWithVat: Boolean!
    supplierTinNumber: String!
    paidAmount: Float!
    status: String!
    statusBy: String!
    HotelName: String! 
  }

  type CostControllerProfile {
    id: Int!
    displayName: String!
    HotelName: String!
    createdAt: DateTime!
  }

  type PurchaseRequest {
    id: Int!
    HotelName: String!
    itemName: String!
    quantity: Float!
    measuredBy: String!
    notes: String!
    estimatedUnitPrice: Float!
    supplierName: String!
    supplierPhone: String!
    category: String!
    status: String!
    storeUserName: String!
    ccProfileId: Int
    ccActorName: String
    ccApprovedAt: DateTime
    financeActorName: String
    financeApprovedAt: DateTime
    rejectionReason: String
    createdAt: DateTime!
  }

  type StockOutRequest {
    id: Int!
    HotelName: String!
    itemRegistrationId: Int!
    """Resolved from master inventory at read time (may be empty if the row was removed)."""
    itemName: String!
    movementType: String!
    amount: Float!
    stakeHolderOrReason: String!
    status: String!
    requestedByUserName: String!
    ccProfileId: Int
    ccActorName: String
    decidedAt: DateTime
    rejectionReason: String
    createdAt: DateTime!
  }

  type KitchenBarBeginning {
    id: Int!
    HotelName: String!
    station: String!
    itemName: String!
    amount: Float!
    measuredBy: String!
    monthPeriod: String!
    calendarDate: String!
    stockOutDay: Float!
    managementTakenDay: Float!
    closingOnHand: Float!
    notes: String!
    createdAt: DateTime!
  }

  type KitchenBarMonthlySnapshot {
    id: Int!
    HotelName: String!
    station: String!
    itemName: String!
    monthPeriod: String!
    """Inclusive calendar start (YYYY-MM-DD) for this roll-up; derived from monthPeriod."""
    periodFrom: String!
    """Inclusive calendar end (YYYY-MM-DD) for this roll-up; derived from monthPeriod."""
    periodTo: String!
    totalImpliedSales: Float!
    lastDayClosingOnHand: Float!
    syncedAt: DateTime!
  }

  type HotelCorporateCreditTier {
    id: Int!
    HotelName: String!
    name: String!
    creditCeiling: Float!
    timeInterval: Int!
    timeFrame: String!
    sortOrder: Int!
    createdAt: DateTime!
  }

  type HotelCreditCompany {
    id: Int!
    HotelName: String!
    companyName: String!
    contactName: String!
    phoneNumber: String!
    email: String!
    creditLevel: String!
    creditLimit: Float!
    timeInterval: Int!
    timeFrame: String!
    hotelCorporateCreditTierId: Int
    allowedMenuJson: String!
    dealNotes: String!
    imageUrl: String!
    createdAt: DateTime!
  }

  type HotelCreditParty {
    id: Int!
    HotelName: String!
    companyId: Int!
    displayName: String!
    phoneNumber: String!
    sex: String!
    notes: String!
    createdAt: DateTime!
  }

  type HotelCreditConsumption {
    id: Int!
    HotelName: String!
    companyId: Int!
    partyId: Int!
    linesJson: String!
    totalAmount: Float!
    occurredAt: DateTime!
    recordedBy: String!
  }

  type Query {
    users: [User!]!
    items: [Item!]!
    orders: [Order!]!
    me: User
    waiters: [waiter!]!
    tables: [table!]!
    cashouts: [cashouts!]!
    creditLevel: [creditLevel!]!
    pityCash: [pityCash!]!
    CreditRegistration: [CreditRegistration!]!
    ItemRegistration: [ItemRegistration!]!
    ItemStatus: [ItemStatus!]!
    costControllerProfiles: [CostControllerProfile!]!
    purchaseRequests: [PurchaseRequest!]!
    stockOutRequests: [StockOutRequest!]!
    kitchenBarBeginnings: [KitchenBarBeginning!]!
    kitchenBarRollupSnapshots(fromYmd: String!, toYmd: String!): [KitchenBarMonthlySnapshot!]!
    hotelCreditCompanies: [HotelCreditCompany!]!
    hotelCorporateCreditTiers: [HotelCorporateCreditTier!]!
    hotelCreditParties(companyId: Int!): [HotelCreditParty!]!
    hotelCreditConsumptions(from: DateTime!, to: DateTime!): [HotelCreditConsumption!]!
  }

  type Mutation {
    Login(UserName: String!, Password: String!): AuthPayload!
    verifyAdminPassword(HotelName: String!, passwordInput: String!): Boolean
    UpdateAdminCredential(Password: String!): User!
    CreateAdmin(
      UserName: String!
      Password: String!
      Role: String!
      HotelName: String!
      LogoUrl: String!
      tinNumber: String
      businessType: String
      modules: String
    ): User!
    CreateCashout(
      items: JSON
      prices: JSON
      measuredBy: JSON
      requiredAmount: JSON
      totalCalc: Float!
    ): cashouts!
    UpdateCredential(UserName: String!, Password: String!, Role: String!): User!
    DeleteCredential(UserName: String!): Boolean!
    CreateCredential(
      UserName: String!
      Password: String!
      Role: String!
      HotelName: String!
      LogoUrl: String
    ): User!
    CreateItem(
      name: String!
      price: Float!
      type: String!
      category: String!
      imageUrl: String!
    ): Item!
    OrderCreation(
      title: String!
      imageUrl: String!
      tableNo: Int!
      waiterName: String!
      orderAmount: Int!
      status: String
      payment: String
      category: String!
      type: String!
      price: Float!
      HotelName: String!
    ): Order!
    UpdatePayment(id: Int!, payment: String, withBank: Boolean): Order!
    UpdateCredit(id: Int!, credittorName: String, creditAmount: Float): Order!
    UpdatePityDeduction(id: Int!, amount: Float!): pityCash!
    UpdateCreditRegistrantDeduction(
      id: Int!
      amount: Float!
    ): CreditRegistration!
    DeleteItem(id: Int!): Item!
    UpdateItem(
      id: Int!
      name: String!
      category: String!
      price: Float!
      type: String!
      imageUrl: String!
    ): Item!
    UpdateStatus(id: Int!, status: String): Order!
    CreateWaiter(
      name: String!
      age: Int!
      sex: String!
      experience: Int!
      phoneNumber: String!
      HotelName: String!
    ): waiter!
    CreateTable(tableNo: Int!, capacity: Int!, HotelName: String!): table!
    UpdatePaymentTable(id: Int!, payment: JSON!, price: JSON!, incomeAt: JSON!): table!
    UpdatePaymentWaiter(
      id: Int!
      payment: JSON!
      price: JSON!
      tablesServed: JSON!
      incomeAt: JSON!
    ): waiter!
    DeleteWaiter(id: Int!): waiter!
    DeleteTable(id: Int!): table!
    UpdateWaiter(
      id: Int!
      name: String!
      age: Int!
      sex: String!
      experience: Int!
      phoneNumber: String!
    ): waiter!
    UpdateTable(id: Int!, tableNo: Int!, capacity: Int!): table!
    BatchOrderCreation(orders: [OrderInput!]!): [Order!]!
    CreateCreditLevel(
      level: String!
      requiredAmount: Float!
      timeInterval: Int!
      timeFrame: String!
      HotelName: String!
    ): creditLevel!
    CreatePityCash(
      amount: Float!
      startDate: DateTime!
      endDate: DateTime!
      HotelName: String!
    ): pityCash!
    CreditRegistration(
      name: String!
      imageUrl: String!
      sex: String!
      creditLevel: String!
      phoneNumber: String!
      amount: Float!
      timeInterval: Int!
      timeFrame: String!
      paidAmount: Float!
      registrationDate: DateTime!
      HotelName: String!
    ): CreditRegistration!
    ItemRegistration(
      name: String!
      imageUrl: String!
      category: String!
      amount: Float!
      measuredBy: String!
      unitPrice: Float!
      registrationDate: DateTime!
      expireDate: DateTime!
      dutyFee: Float!
      supplierName: String!
      supplierPhone: String!
      Address: String!
      supplierLevel: String!
      purchaseWithVat: Boolean
      supplierTinNumber: String
      paidAmount: Float!
      HotelName: String!
    ): ItemRegistration!
    DeleteCreditLevel(id: Int!): creditLevel!
    DeletePityCash(id: Int!): pityCash!
    DeleteCreditRegistration(id: Int!): CreditRegistration!
    DeleteItemRegistration(id: Int!): ItemRegistration!
    UpdateCreditLevel(
      id: Int!
      level: String!
      requiredAmount: Float!
      timeInterval: Int!
      timeFrame: String!
    ): creditLevel!
    UpdatePityCash(
      id: Int!
      amount: Float!
      startDate: DateTime!
      endDate: DateTime!
    ): pityCash!
    UpdateCreditRegistration(
      id: Int!
      name: String!
      imageUrl: String!
      sex: String!
      creditLevel: String!
      phoneNumber: String!
      amount: Float!
      timeInterval: Int!
      timeFrame: String!
      paidAmount: Float!
      registrationDate: DateTime!
    ): CreditRegistration!
    UpdateItemRegistration(
      id: Int!
      name: String!
      imageUrl: String!
      category: String!
      amount: Float!
      measuredBy: String!
      unitPrice: Float!
      registrationDate: DateTime!
      expireDate: DateTime!
      dutyFee: Float!
      supplierName: String!
      supplierPhone: String!
      Address: String!
      supplierLevel: String!
      purchaseWithVat: Boolean
      supplierTinNumber: String
      paidAmount: Float!
    ): ItemRegistration!
    CreateItemStatus(name: String!
    imageUrl: String!
    category: String!
    amount: Float!
    measuredBy: String!
    unitPrice: Float!   
    actionDate: DateTime!
    supplierName: String!
    supplierPhone: String!   
    Address:       String!
    supplierLevel: String!
    purchaseWithVat: Boolean
    supplierTinNumber: String
    paidAmount: Float!
    status: String!
    statusBy: String!
    HotelName: String!): ItemStatus!
    DeleteItemStatus(id: Int!): ItemStatus!

    createCostControllerProfile(displayName: String!): CostControllerProfile!
    deleteCostControllerProfile(id: Int!): Boolean!

    createPurchaseRequest(
      itemName: String!
      quantity: Float!
      measuredBy: String!
      notes: String
      estimatedUnitPrice: Float
      supplierName: String
      supplierPhone: String
      category: String
    ): PurchaseRequest!

    approvePurchaseRequestCC(id: Int!, costControllerProfileId: Int!): PurchaseRequest!
    rejectPurchaseRequestCC(id: Int!, reason: String): PurchaseRequest!

    approvePurchaseRequestFinance(id: Int!): PurchaseRequest!
    rejectPurchaseRequestFinance(id: Int!, reason: String): PurchaseRequest!

    createStockOutRequest(
      itemRegistrationId: Int!
      movementType: String!
      amount: Float!
      stakeHolderOrReason: String!
    ): StockOutRequest!

    approveStockOutRequest(id: Int!, costControllerProfileId: Int!): StockOutRequest!
    rejectStockOutRequest(id: Int!, reason: String): StockOutRequest!

    createKitchenBarBeginning(
      station: String!
      itemName: String!
      amount: Float!
      measuredBy: String!
      managementTakenDay: Float
      monthPeriod: String
      calendarDate: String!
      notes: String
    ): KitchenBarBeginning!

    updateKitchenBarBeginning(
      id: Int!
      station: String!
      itemName: String!
      amount: Float!
      measuredBy: String!
      managementTakenDay: Float
      monthPeriod: String
      calendarDate: String!
      notes: String
    ): KitchenBarBeginning!

    deleteKitchenBarBeginning(id: Int!): Boolean!

    syncKitchenBarRollup(fromYmd: String!, toYmd: String!): [KitchenBarMonthlySnapshot!]!

    createHotelCreditCompany(
      companyName: String!
      contactName: String
      phoneNumber: String!
      email: String
      hotelCorporateCreditTierId: Int!
      allowedMenuJson: String!
      dealNotes: String
      imageUrl: String
    ): HotelCreditCompany!

    updateHotelCreditCompany(
      id: Int!
      companyName: String!
      contactName: String
      phoneNumber: String!
      email: String
      hotelCorporateCreditTierId: Int
      allowedMenuJson: String!
      dealNotes: String
      imageUrl: String
    ): HotelCreditCompany!

    deleteHotelCreditCompany(id: Int!): Boolean!

    createHotelCreditParty(
      companyId: Int!
      displayName: String!
      phoneNumber: String
      sex: String
      notes: String
    ): HotelCreditParty!

    createHotelCreditConsumption(
      companyId: Int!
      partyId: Int
      guestName: String
      guestPhone: String
      linesJson: String!
      totalAmount: Float!
      occurredAt: DateTime
    ): HotelCreditConsumption!

    createHotelCorporateCreditTier(
      name: String!
      creditCeiling: Float!
      timeInterval: Int!
      timeFrame: String!
      sortOrder: Int
    ): HotelCorporateCreditTier!

    updateHotelCorporateCreditTier(
      id: Int!
      name: String!
      creditCeiling: Float!
      timeInterval: Int!
      timeFrame: String!
      sortOrder: Int
    ): HotelCorporateCreditTier!

    deleteHotelCorporateCreditTier(id: Int!): Boolean!
  }
`;

const authenticate = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  try {
    return jwt.verify(token, JWT_Secret);
  } catch {
    return null;
  }
};

function assertAuthenticated(context) {
  if (!context.user) throw new Error("Not Authenticated");
}

function assertRole(context, allowed) {
  assertAuthenticated(context);
  if (!allowed.includes(context.user.Role)) {
    throw new Error("Not authorized");
  }
}

function assertNotHotelStoreForCreditReports(context) {
  assertAuthenticated(context);
  const bt = String(context.user.businessType || "").trim();
  const lodging = bt === "Hotel" || bt === "Resort" || bt === "Pension";
  if (context.user.Role === "Store" && lodging) {
    throw new Error("Not authorized");
  }
}

function monthPeriodFromCalendarDate(calendarDate) {
  const s = String(calendarDate).trim();
  if (s.length < 7) throw new Error("calendarDate must be YYYY-MM-DD");
  return s.slice(0, 7);
}

const ROLLUP_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Normalize inclusive YYYY-MM-DD range; returns canonical storage key `from|to`. */
function normalizeRollupRangeYmd(fromYmd, toYmd) {
  let a = String(fromYmd || "").trim();
  let b = String(toYmd || "").trim();
  if (!ROLLUP_YMD_RE.test(a) || !ROLLUP_YMD_RE.test(b)) {
    throw new Error("fromYmd and toYmd must be YYYY-MM-DD");
  }
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  return { fromYmd: a, toYmd: b, rangeKey: `${a}|${b}` };
}

/** Derive display bounds from DB `monthPeriod`: range key `YYYY-MM-DD|YYYY-MM-DD` or legacy `YYYY-MM`. */
function periodBoundsFromSnapshotMonthPeriod(monthPeriod) {
  const s = String(monthPeriod || "").trim();
  const range = /^(\d{4}-\d{2}-\d{2})\|(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (range) return { from: range[1], to: range[2] };
  const ym = /^(\d{4}-\d{2})$/.exec(s);
  if (ym) {
    const y = Number(ym[1].slice(0, 4));
    const m = Number(ym[1].slice(5, 7));
    const last = new Date(y, m, 0);
    const ld = String(last.getDate()).padStart(2, "0");
    return { from: `${ym[1]}-01`, to: `${ym[1]}-${ld}` };
  }
  return { from: "", to: "" };
}

function hotelCreditWindowStart(timeInterval, timeFrame) {
  const d = new Date();
  const n = Math.max(1, Number(timeInterval) || 1);
  const tf = String(timeFrame || "Month").toLowerCase();
  if (
    tf === "day" ||
    tf === "days" ||
    tf === "daily"
  ) {
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
  } else if (tf === "week" || tf === "weeks" || tf === "weekly") {
    d.setDate(d.getDate() - 7 * n);
  } else if (tf === "year" || tf === "years" || tf === "yearly") {
    d.setFullYear(d.getFullYear() - n);
  } else {
    d.setMonth(d.getMonth() - n);
  }
  return d;
}

/** Align store stakeholder text / legacy CHEF with canonical daily-count station keys. */
function normalizeKitchenBarStation(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!s) return "OTHER";
  if (s === "chef" || s === "kitchen" || s === "chef (kitchen)") return "KITCHEN";
  if (s === "bar" || s === "barista") return "BAR";
  if (s === "juicer") return "JUICER";
  if (s === "cleaning service" || s === "cleaning") return "CLEANING";
  if (s === "housekeeping") return "HOUSEKEEPING";
  if (s === "admin" || s === "management" || s === "manager") return "MANAGEMENT";
  if (s === "maintenance") return "MAINTENANCE";
  const up = String(raw ?? "").trim().toUpperCase();
  if (up === "CHEF" || up === "KITCHEN") return "KITCHEN";
  if (up === "BAR") return "BAR";
  return up.replace(/\s+/g, "_") || "OTHER";
}

function kitchenBarStationPrismaWhere(stationKey) {
  if (stationKey === "KITCHEN") {
    return { OR: [{ station: "KITCHEN" }, { station: "CHEF" }] };
  }
  return { station: stationKey };
}

function ymdUtcFromDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Previous day’s physical lights-out: prefer stored closing when > 0, else opening pulse (legacy rows). */
function prevPhysicalLights(prevRow) {
  if (!prevRow) return null;
  const c = Number(prevRow.closingOnHand);
  const a = Number(prevRow.amount);
  return c > 0 ? c : a;
}

function computeClosingOnHand(opening, stockOutSum, managementTakenDay, prevRow) {
  const prevLights = prevPhysicalLights(prevRow);
  const salesToday = prevLights != null ? Number(opening) - prevLights : 0;
  const mgmt = Number(managementTakenDay ?? 0);
  return Number(opening) + Number(stockOutSum) - salesToday - mgmt;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function findPreviousKitchenBarRow(
  client,
  hotelName,
  stationKey,
  itemNameTrimmed,
  calendarDateYmd,
) {
  const rows = await client.kitchenBarBeginning.findMany({
    where: {
      HotelName: hotelName,
      itemName: String(itemNameTrimmed).trim(),
      calendarDate: { lt: String(calendarDateYmd).trim() },
      ...kitchenBarStationPrismaWhere(stationKey),
    },
    orderBy: { calendarDate: "desc" },
    take: 1,
  });
  return rows[0] ?? null;
}

async function sumApprovedStockOutToStation(
  client,
  hotelName,
  stationKey,
  itemNameTrimmed,
  calendarDateYmd,
) {
  const cal = String(calendarDateYmd).trim();
  const start = new Date(`${cal}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const requests = await client.stockOutRequest.findMany({
    where: {
      HotelName: hotelName,
      movementType: "STOCK_OUT",
      status: "APPROVED",
      decidedAt: { gte: start, lt: end },
    },
  });
  if (requests.length === 0) return 0;
  const itemIds = [...new Set(requests.map((r) => r.itemRegistrationId))];
  const items = await client.itemRegistration.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true },
  });
  const idToName = new Map(
    items.map((i) => [i.id, String(i.name ?? "").trim()]),
  );
  const normItem = String(itemNameTrimmed).trim();
  let sum = 0;
  for (const r of requests) {
    if (normalizeKitchenBarStation(r.stakeHolderOrReason) !== stationKey) {
      continue;
    }
    const reqItemName = String(
      idToName.get(r.itemRegistrationId) || r.itemNameSnapshot || "",
    ).toLowerCase();
    if (reqItemName !== normItem.toLowerCase()) {
      continue;
    }
    sum += Number(r.amount);
  }
  return sum;
}

async function refreshKitchenBarComputedFields(client, row) {
  const stationKey = normalizeKitchenBarStation(row.station);
  const item = String(row.itemName).trim();
  const cal = String(row.calendarDate).trim();
  const sum = await sumApprovedStockOutToStation(
    client,
    row.HotelName,
    stationKey,
    item,
    cal,
  );
  const prev = await findPreviousKitchenBarRow(
    client,
    row.HotelName,
    stationKey,
    item,
    cal,
  );
  const closing = round2(
    computeClosingOnHand(
      Number(row.amount),
      sum,
      Number(row.managementTakenDay ?? 0),
      prev,
    ),
  );
  return client.kitchenBarBeginning.update({
    where: { id: row.id },
    data: {
      station: stationKey,
      stockOutDay: round2(sum),
      closingOnHand: closing,
    },
  });
}

async function reconcileKitchenBarDailyRows(
  client,
  hotelName,
  itemNameTrimmed,
  stakeholderRaw,
  decidedAt,
) {
  const cal = ymdUtcFromDate(decidedAt);
  const stationKey = normalizeKitchenBarStation(stakeholderRaw);
  const rows = await client.kitchenBarBeginning.findMany({
    where: {
      HotelName: hotelName,
      itemName: String(itemNameTrimmed).trim(),
      calendarDate: cal,
      ...kitchenBarStationPrismaWhere(stationKey),
    },
  });
  for (const row of rows) {
    await refreshKitchenBarComputedFields(client, row);
  }
}

const resolvers = {
  JSON: GraphQLJSON,
  DateTime: DateTimeResolver,
  KitchenBarMonthlySnapshot: {
    periodFrom: (p) => periodBoundsFromSnapshotMonthPeriod(p.monthPeriod).from,
    periodTo: (p) => periodBoundsFromSnapshotMonthPeriod(p.monthPeriod).to,
  },
  StockOutRequest: {
    itemName: async (parent, _, { prisma }) => {
      const snap = String(parent.itemNameSnapshot ?? "").trim();
      if (snap) return snap;
      const reg = await prisma.itemRegistration.findUnique({
        where: { id: parent.itemRegistrationId },
      });
      return reg?.name != null && String(reg.name).trim() !== ""
        ? String(reg.name).trim()
        : "";
    },
  },
  Query: {
    users: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.user.findMany({
        where: sameOrganizationWhere(context),
      });
    },
    items: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.item.findMany({
        where: tenantHotelReadWhere(context),
      });
    },
    orders: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.order.findMany({
        where: tenantHotelReadWhere(context),
      });
    },
    me: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.user.findUnique({
        where: { id: context.user.userId },
        select: {
          id: true,
          UserName: true,
          Role: true,
          HotelName: true,
          LogoUrl: true,
          tinNumber: true,
        },
      });
    },
    waiters: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.waiter.findMany({
        where: tenantHotelReadWhere(context),
      });
    },
    tables: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.table.findMany({
        where: tenantHotelReadWhere(context),
      });
    },
    cashouts: async (_, __, context) => {
      if (!context.user) {
        throw new Error("Not Authenticated");
      }

      try {
        const whereClause = tenantHotelReadWhere(context);

        const results = await prisma.cashouts.findMany({
          where: whereClause,
        });

        return results;
      } catch (error) {
        throw error;
      }
    },
    creditLevel: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.creditLevel.findMany({
        where: tenantHotelReadWhere(context),
      });
    },
    pityCash: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.pityCash.findMany({
        where: tenantHotelReadWhere(context),
      });
    },
    CreditRegistration: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.creditRegistration.findMany({
        where: tenantHotelReadWhere(context),
      });
    },
    ItemRegistration: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const rows = await prisma.itemRegistration.findMany({
        where: tenantHotelReadWhere(context),
      });
      if (rows.length === 0) return rows;
      const names = [...new Set(rows.map((r) => String(r.name || "").trim()))];
      const statuses = await prisma.itemStatus.findMany({
        where: {
          ...tenantHotelReadWhere(context),
          name: { in: names },
          status: { in: ["Stock Out", "Wastage", "Returned to Supplier"] },
        },
      });
      const inventoryIdentityKey = (row) =>
        [
          String(row.name || "").trim().toLowerCase(),
          Number(row.unitPrice || 0).toFixed(4),
          String(row.supplierName || "").trim().toLowerCase(),
          String(row.supplierPhone || "").trim(),
          String(row.Address || "").trim().toLowerCase(),
        ].join("|");

      const deductedByIdentity = new Map();
      for (const s of statuses) {
        const k = inventoryIdentityKey(s);
        deductedByIdentity.set(
          k,
          (deductedByIdentity.get(k) || 0) + (Number(s.amount) || 0),
        );
      }
      return rows.map((r) => {
        const deducted = deductedByIdentity.get(inventoryIdentityKey(r)) || 0;
        const registeredAmount = Number(r.amount) + deducted;
        const registeredValue = computeInventoryTotalETB({
          amount: registeredAmount,
          unitPrice: r.unitPrice,
          dutyFee: r.dutyFee,
          purchaseWithVat: r.purchaseWithVat,
        });
        return {
          ...r,
          registeredAmount,
          registeredValue,
        };
      });
    },
    ItemStatus: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.itemStatus.findMany({
        where: tenantHotelReadWhere(context),
      });
    },
    costControllerProfiles: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.costControllerProfile.findMany({
        where: tenantHotelReadWhere(context),
        orderBy: { createdAt: "asc" },
      });
    },
    purchaseRequests: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.purchaseRequest.findMany({
        where: tenantHotelReadWhere(context),
        orderBy: { createdAt: "desc" },
      });
    },
    stockOutRequests: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.stockOutRequest.findMany({
        where: tenantHotelReadWhere(context),
        orderBy: { createdAt: "desc" },
      });
    },
    kitchenBarBeginnings: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const tenant = tenantScopeFromContext(context);
      await prisma.$executeRaw`
        UPDATE KitchenBarBeginning
        SET calendarDate = CONCAT(monthPeriod, '-01')
        WHERE HotelName = ${tenant}
        AND (calendarDate = '' OR calendarDate IS NULL)
      `;
      return await prisma.kitchenBarBeginning.findMany({
        where: tenantHotelReadWhere(context),
        orderBy: [{ calendarDate: "asc" }, { id: "asc" }],
      });
    },

    kitchenBarRollupSnapshots: async (_, { fromYmd, toYmd }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const { rangeKey } = normalizeRollupRangeYmd(fromYmd, toYmd);
      return await prisma.kitchenBarMonthlySnapshot.findMany({
        where: {
          ...tenantHotelReadWhere(context),
          monthPeriod: rangeKey,
        },
        orderBy: [{ station: "asc" }, { itemName: "asc" }],
      });
    },

    hotelCreditCompanies: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      assertNotHotelStoreForCreditReports(context);
      return await prisma.hotelCreditCompany.findMany({
        where: tenantHotelReadWhere(context),
        orderBy: { createdAt: "desc" },
      });
    },

    hotelCorporateCreditTiers: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      assertNotHotelStoreForCreditReports(context);
      return await prisma.hotelCorporateCreditTier.findMany({
        where: tenantHotelReadWhere(context),
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
    },

    hotelCreditParties: async (_, { companyId }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      assertNotHotelStoreForCreditReports(context);
      const id = Number(companyId);
      const company = await prisma.hotelCreditCompany.findUnique({
        where: { id },
      });
      if (!company || !tenantHotelReadMatches(context, company.HotelName)) {
        throw new Error("Company not found");
      }
      return await prisma.hotelCreditParty.findMany({
        where: { companyId: id, HotelName: company.HotelName },
        orderBy: { createdAt: "desc" },
      });
    },

    hotelCreditConsumptions: async (_, { from, to }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      assertNotHotelStoreForCreditReports(context);
      const fromD = new Date(from);
      const toD = new Date(to);
      return await prisma.hotelCreditConsumption.findMany({
        where: {
          ...tenantHotelReadWhere(context),
          occurredAt: { gte: fromD, lte: toD },
        },
        orderBy: { occurredAt: "desc" },
      });
    },
  },
  Mutation: {
    CreateAdmin: async (
      _,
      {
        UserName,
        Password,
        Role,
        HotelName,
        LogoUrl,
        tinNumber,
        businessType,
        modules,
      },
    ) => {
      const userNameNorm = String(UserName).trim();
      const existingUsername = await prisma.user.findUnique({
        where: { UserName: userNameNorm },
      });
      if (existingUsername) {
        throw new Error("User already exists");
      }

      const resolvedTin = await allocateUniqueTinNumber(
        prisma,
        tinNumber || "",
      );

      let modulesJson = modules;
      if (modulesJson == null || modulesJson === "") {
        modulesJson = [];
      } else if (typeof modulesJson === "string") {
        try {
          modulesJson = JSON.parse(modulesJson);
        } catch {
          modulesJson = [];
        }
      }
      if (!Array.isArray(modulesJson)) {
        modulesJson = [];
      }

      const hashedPassword = await bcrypt.hash(Password, 12);
      return await prisma.user.create({
        data: {
          UserName: userNameNorm,
          Password: hashedPassword,
          Role,
          HotelName: HotelName.trim(),
          LogoUrl,
          tinNumber: resolvedTin,
          businessType: businessType || null,
          modules: modulesJson,
        },
      });
    },
    CreateCashout: async (
      _,
      { items, prices, measuredBy, requiredAmount, totalCalc },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.cashouts.create({
        data: {
          items,
          prices,
          measuredBy,
          requiredAmount,
          totalCalc,
          HotelName: tenantScopeFromContext(context),
        },
      });
    },
    Login: async (_, { UserName, Password }) => {
      const user = await prisma.user.findUnique({
        where: { UserName: String(UserName).trim() },
      });
      if (!user) throw new Error("No user found in this account");
      const valid = await bcrypt.compare(Password, user.Password);
      if (!valid) throw new Error("Invalid Password");
      const tenantId =
        user.tinNumber != null && String(user.tinNumber).trim() !== ""
          ? String(user.tinNumber).trim()
          : String(user.HotelName).trim();

      const token = jwt.sign(
        {
          userId: user.id,
          UserName: user.UserName,
          Role: user.Role,
          HotelName: user.HotelName,
          tinNumber: user.tinNumber,
          tenantId,
          businessType: user.businessType ?? null,
        },
        JWT_Secret,
        { expiresIn: JWT_EXPIRES_IN },
      );
      return {
        token,
        user: {
          id: user.id,
          UserName: user.UserName,
          Role: user.Role,
          HotelName: user.HotelName,
          LogoUrl: user.LogoUrl,
          tinNumber: user.tinNumber,
          businessType: user.businessType,
          modules: user.modules,
        },
      };
    },
    verifyAdminPassword: async (_, { HotelName, passwordInput }) => {
      let admin = await prisma.user.findFirst({
        where: { tinNumber: HotelName, Role: { in: ["Admin", "Manager"] } },
      });
      if (!admin) {
        admin = await prisma.user.findFirst({
          where: { HotelName: HotelName, Role: { in: ["Admin", "Manager"] } },
        });
      }
      if (!admin) return false;

      const isMatch = await bcrypt.compare(passwordInput, admin.Password);
      return isMatch;
    },
    CreateCredential: async (
      _,
      { UserName, Password, Role, HotelName, LogoUrl },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      if (!["Admin", "Manager"].includes(context.user.Role)) {
        throw new Error("Not authorized");
      }

      const userNameNorm = String(UserName).trim();
      const existingUser = await prisma.user.findUnique({
        where: { UserName: userNameNorm },
      });

      if (existingUser) {
        throw new Error(
          "Username already exists. Please choose a different username.",
        );
      }

      const orgTin =
        context.user.tinNumber != null &&
        String(context.user.tinNumber).trim() !== ""
          ? String(context.user.tinNumber).trim()
          : tenantScopeFromContext(context);

      const hashedPassword = await bcrypt.hash(Password, 12);
      const creator = await prisma.user.findUnique({
        where: { id: context.user.userId },
      });
      const businessType =
        (creator && creator.businessType) ||
        context.user.businessType ||
        null;
      return await prisma.user.create({
        data: {
          UserName: userNameNorm,
          Password: hashedPassword,
          HotelName: context.user.HotelName,
          tinNumber: orgTin,
          Role,
          LogoUrl,
          businessType,
        },
      });
    },
    BatchOrderCreation: async (_, { orders }, context) => {
      if (!context.user) throw new Error("Not Authenticated");

      try {
        const createdOrders = await prisma.$transaction(
          orders.map((orderData) =>
            prisma.order.create({
              data: {
                title: orderData.title,
                imageUrl: orderData.imageUrl,
                tableNo: orderData.tableNo,
                waiterName: orderData.waiterName,
                orderAmount: orderData.orderAmount,
                HotelName: tenantScopeFromContext(context),
                status: orderData.status || null,
                payment: orderData.payment || "Unpaid",
                category: orderData.category,
                type: orderData.type,
                price: orderData.price,
              },
            }),
          ),
        );

        return createdOrders;
      } catch (error) {
        throw error;
      }
    },
    UpdateAdminCredential: async (_, { Password }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      if (!["Admin", "Manager"].includes(context.user.Role)) {
        throw new Error("Not authorized");
      }

      const hashedPassword = await bcrypt.hash(Password, 12);

      const admin = await prisma.user.findFirst({
        where: {
          ...sameOrganizationWhere(context),
          Role: { in: ["Admin", "Manager"] },
        },
      });

      if (!admin) throw new Error("Admin not found");

      return await prisma.user.update({
        where: { id: admin.id },
        data: { Password: hashedPassword },
      });
    },
    UpdateCredential: async (_, { UserName, Password, Role }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      if (!["Admin", "Manager"].includes(context.user.Role)) {
        throw new Error("Not authorized");
      }

      const userNameNorm = String(UserName).trim();
      const user = await prisma.user.findFirst({
        where: {
          ...sameOrganizationWhere(context),
          UserName: userNameNorm,
        },
      });

      if (!user) throw new Error("User not found");
      if (user.Role === "Admin" || user.Role === "Manager") {
        throw new Error("Admin accounts cannot be updated from this form");
      }

      const hashedPassword = await bcrypt.hash(Password, 12);

      return await prisma.user.update({
        where: { id: user.id },
        data: {
          Password: hashedPassword,
          Role,
        },
      });
    },
    DeleteCredential: async (_, { UserName }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      if (!["Admin", "Manager"].includes(context.user.Role)) {
        throw new Error("Not authorized");
      }

      const userNameNorm = String(UserName).trim();
      if (userNameNorm === String(context.user.UserName || "").trim()) {
        throw new Error("You cannot delete your own account");
      }

      const target = await prisma.user.findFirst({
        where: {
          ...sameOrganizationWhere(context),
          UserName: userNameNorm,
        },
      });

      if (!target) throw new Error("User not found");
      if (target.Role === "Admin" || target.Role === "Manager") {
        throw new Error("Admin accounts cannot be deleted here");
      }

      await prisma.user.delete({
        where: { id: target.id },
      });
      return true;
    },
    CreateItem: async (
      _,
      { name, price, category, imageUrl, type },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.item.create({
        data: {
          name,
          price,
          category,
          type,
          imageUrl,
          HotelName: tenantScopeFromContext(context),
        },
      });
    },
    OrderCreation: async (
      _,
      {
        title,
        imageUrl,
        tableNo,
        waiterName,
        status,
        payment,
        category,
        type,
        price,
        orderAmount,
      },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      try {
        const order = await prisma.order.create({
          data: {
            title,
            imageUrl,
            tableNo,
            waiterName,
            orderAmount,
            status,
            HotelName: tenantScopeFromContext(context),
            payment,
            category,
            type,
            price,
          },
        });

        return order;
      } catch (error) {
        throw error;
      }
    },
    UpdatePayment: async (_, { id, payment, withBank }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const order = await prisma.order.findUnique({
        where: { id: id },
      });
      if (!order || !tenantHotelReadMatches(context, order.HotelName)) {
        throw new Error("Order not found or not authorized");
      }
      return await prisma.order.update({
        where: { id: id },
        data: {
          payment: payment,
          withBank: withBank,
        },
      });
    },
    UpdateCredit: async (_, { id, credittorName, creditAmount }, context) => {
      if (!context.user) {
        throw new Error("Not Authenticated");
      }

      try {
        const order = await prisma.order.findUnique({
          where: { id: id },
        });

        if (!order) {
          throw new Error("Order not found");
        }

        if (!tenantHotelReadMatches(context, order.HotelName)) {
          throw new Error("Not authorized to update this order");
        }

        const updatedOrder = await prisma.order.update({
          where: { id: id },
          data: {
            credit: true,
            credittorName: credittorName,
            creditAmount: creditAmount,
            payment: "Paid",
            withBank: null,
          },
        });

        return updatedOrder;
      } catch (error) {
        throw error;
      }
    },
    DeleteItem: async (_, { id }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const item = await prisma.item.findUnique({
        where: { id: id },
      });
      if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
        throw new Error("Item not found or not authorized");
      }
      return await prisma.item.delete({
        where: { id: id },
      });
    },
    UpdatePityDeduction: async (_, { id, amount }, context) => {
      if (!context.user) throw new Error("Not Authenticated");

      const pityCash = await prisma.pityCash.findUnique({
        where: { id: id },
      });

      if (!pityCash || !tenantHotelReadMatches(context, pityCash.HotelName)) {
        throw new Error("Pity Cash not found or not authorized");
      }

      return await prisma.pityCash.update({
        where: { id: id },
        data: {
          amount: amount,
        },
      });
    },
    UpdateCreditRegistrantDeduction: async (_, { id, amount }, context) => {
      if (!context.user) throw new Error("Not Authenticated");

      const creditReg = await prisma.creditRegistration.findUnique({
        where: { id: id },
      });

      if (!creditReg || !tenantHotelReadMatches(context, creditReg.HotelName)) {
        throw new Error("Credit Registration not found or not authorized");
      }

      return await prisma.creditRegistration.update({
        where: { id: id },
        data: {
          amount: amount,
        },
      });
    },
    UpdateItem: async (
      _,
      { id, name, category, price, imageUrl, type },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      try {
        const item = await prisma.item.findUnique({
          where: { id: id },
        });
        if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
          throw new Error("Item not found or not authorized");
        }
        const updated = await prisma.item.update({
          where: { id: id },
          data: { name, price, category, type, imageUrl },
        });
        return updated;
      } catch (e) {
        throw e;
      }
    },
    UpdateStatus: async (_, { id, status }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const order = await prisma.order.findUnique({
        where: { id: id },
      });
      if (!order || !tenantHotelReadMatches(context, order.HotelName)) {
        throw new Error("Order not found or not authorized");
      }
      return await prisma.order.update({
        where: { id: id },
        data: {
          status: status,
        },
      });
    },
    CreateWaiter: async (
      _,
      { name, age, sex, experience, phoneNumber },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.waiter.create({
        data: {
          name,
          HotelName: tenantScopeFromContext(context),
          age,
          sex,
          experience,
          phoneNumber,
          price: [],
          tablesServed: [],
          payment: [],
          incomeAt: [],
        },
      });
    },
    CreateTable: async (_, { tableNo, capacity }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.table.create({
        data: {
          tableNo,
          HotelName: tenantScopeFromContext(context),
          capacity,
          price: [], // default empty array
          payment: [], // default empty array
          incomeAt: [],
        },
      });
    },
    UpdatePaymentWaiter: async (
      _,
      { payment, price, tablesServed, incomeAt, id },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      const waiter = await prisma.waiter.findUnique({
        where: { id: id },
      });
      if (!waiter || !tenantHotelReadMatches(context, waiter.HotelName)) {
        throw new Error("Waiter not found or not authorized");
      }
      // combine existing arrays with new values so we don't overwrite
      const existingPayment = Array.isArray(waiter.payment)
        ? waiter.payment
        : [];
      const existingPrice = Array.isArray(waiter.price) ? waiter.price : [];
      const existingTables = Array.isArray(waiter.tablesServed)
        ? waiter.tablesServed
        : [];
      const existingIncomeAt = Array.isArray(waiter.incomeAt)
        ? waiter.incomeAt
        : [];
      const newIncomeAt = Array.isArray(incomeAt) ? incomeAt : [];
      return await prisma.waiter.update({
        where: { id: id },
        data: {
          payment: [...existingPayment, ...payment],
          price: [...existingPrice, ...price],
          tablesServed: [...existingTables, ...tablesServed],
          incomeAt: [...existingIncomeAt, ...newIncomeAt],
        },
      });
    },
    UpdatePaymentTable: async (_, { id, payment, price, incomeAt }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const table = await prisma.table.findUnique({
        where: { id: id },
      });
      if (!table || !tenantHotelReadMatches(context, table.HotelName)) {
        throw new Error("Table not found or not authorized");
      }
      const existingPayment = Array.isArray(table.payment) ? table.payment : [];
      const existingPrice = Array.isArray(table.price) ? table.price : [];
      const existingIncomeAt = Array.isArray(table.incomeAt)
        ? table.incomeAt
        : [];
      const newIncomeAt = Array.isArray(incomeAt) ? incomeAt : [];
      return await prisma.table.update({
        where: { id: id },
        data: {
          payment: [...existingPayment, ...payment],
          price: [...existingPrice, ...price],
          incomeAt: [...existingIncomeAt, ...newIncomeAt],
        },
      });
    },
    DeleteWaiter: async (_, { id }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const waiter = await prisma.waiter.findUnique({
        where: { id: id },
      });
      if (!waiter || !tenantHotelReadMatches(context, waiter.HotelName)) {
        throw new Error("Waiter not found or not authorized");
      }
      return await prisma.waiter.delete({
        where: { id: id },
      });
    },
    DeleteTable: async (_, { id }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const table = await prisma.table.findUnique({
        where: { id: id },
      });
      if (!table || !tenantHotelReadMatches(context, table.HotelName)) {
        throw new Error("Table not found or not authorized");
      }
      return await prisma.table.delete({
        where: { id: id },
      });
    },
    UpdateWaiter: async (
      _,
      { id, name, age, sex, experience, phoneNumber },
      context,
    ) => {
      if (!context.user) throw new Error("Not authenticated");
      const waiter = await prisma.waiter.findUnique({
        where: { id: id },
      });
      if (!waiter || !tenantHotelReadMatches(context, waiter.HotelName)) {
        throw new Error("Waiter not found or not authorized");
      }
      return await prisma.waiter.update({
        where: { id: id },
        data: {
          name: name,
          age: age,
          sex: sex,
          experience: experience,
          phoneNumber: phoneNumber,
        },
      });
    },
    UpdateTable: async (_, { id, tableNo, capacity }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const table = await prisma.table.findUnique({
        where: { id: id },
      });
      if (!table || !tenantHotelReadMatches(context, table.HotelName)) {
        throw new Error("Table not found or not authorized");
      }
      return await prisma.table.update({
        where: { id: id },
        data: { tableNo: tableNo, capacity: capacity },
      });
    },
    CreateCreditLevel: async (
      _,
      { level, requiredAmount, timeInterval, timeFrame },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.creditLevel.create({
        data: {
          level,
          requiredAmount,
          timeInterval,
          timeFrame,
          HotelName: tenantScopeFromContext(context),
        },
      });
    },
    CreatePityCash: async (_, { amount, startDate, endDate }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.pityCash.create({
        data: {
          amount,
          startDate,
          endDate,
          HotelName: tenantScopeFromContext(context),
        },
      });
    },
    CreditRegistration: async (
      _,
      {
        name,
        imageUrl,
        sex,
        creditLevel,
        phoneNumber,
        amount,
        timeInterval,
        timeFrame,
        paidAmount,
        registrationDate,
      },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.creditRegistration.create({
        data: {
          name,
          imageUrl,
          sex,
          creditLevel,
          phoneNumber,
          amount,
          timeInterval,
          timeFrame,
          paidAmount,
          registrationDate,
          HotelName: tenantScopeFromContext(context),
        },
      });
    },
    ItemRegistration: async (
      _,
      {
        name,
        imageUrl,
        category,
        amount,
        measuredBy,
        unitPrice,
        registrationDate,
        expireDate,
        dutyFee,
        supplierName,
        supplierPhone,
        Address,
        supplierLevel,
        purchaseWithVat,
        supplierTinNumber,
        paidAmount,
      },
      context
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      const norm = (s) => String(s ?? "").trim().toLowerCase();
      const wanted = norm(name);
      const existingRows = await prisma.itemRegistration.findMany({
        where: tenantHotelReadWhere(context),
      });
      if (
        existingRows.some((r) => norm(r.name) === wanted && wanted.length > 0)
      ) {
        throw new Error(
          "The item already exists. You can edit it from the Inventory tab.",
        );
      }
      return await prisma.itemRegistration.create({
        data: {
          name,
          imageUrl,
          category,
          amount,
          measuredBy,
          unitPrice,
          registrationDate,
          expireDate,
          dutyFee,
          supplierName,
          supplierPhone,
          Address,
          supplierLevel,
          purchaseWithVat: isVatEnabled(purchaseWithVat),
          supplierTinNumber: String(supplierTinNumber ?? "").trim(),
          paidAmount,
          HotelName: tenantScopeFromContext(context),
        },
      });
    },
    DeleteCreditLevel: async (_, { id }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const creditLevel = await prisma.creditLevel.findUnique({
        where: { id: id },
      });
      if (!creditLevel || !tenantHotelReadMatches(context, creditLevel.HotelName)) {
        throw new Error("Credit Level not found or not authorized");
      }
      return await prisma.creditLevel.delete({
        where: { id: id },
      });
    },
    DeletePityCash: async (_, { id }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const pityCash = await prisma.pityCash.findUnique({
        where: { id: id },
      });
      if (!pityCash || !tenantHotelReadMatches(context, pityCash.HotelName)) {
        throw new Error("Pity Cash not found or not authorized");
      }
      return await prisma.pityCash.delete({
        where: { id: id },
      });
    },
    DeleteCreditRegistration: async (_, { id }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const creditRegistration = await prisma.creditRegistration.findUnique({
        where: { id: id },
      });
      if (
        !creditRegistration ||
        !tenantHotelReadMatches(context, creditRegistration.HotelName)
      ) {
        throw new Error("Credit Registration not found or not authorized");
      }
      return await prisma.creditRegistration.delete({
        where: { id: id },
      });
    },
    DeleteItemRegistration: async (_, { id }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const itemRegistration = await prisma.itemRegistration.findUnique({
        where: { id: id },
      });
      if (
        !itemRegistration ||
        !tenantHotelReadMatches(context, itemRegistration.HotelName)
      ) {
        throw new Error("Item Registration not found or not authorized");
      }
      return await prisma.itemRegistration.delete({
        where: { id: id },
      });
    },
    UpdateCreditLevel: async (
      _,
      { id, level, requiredAmount, timeInterval, timeFrame },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      const creditLevel = await prisma.creditLevel.findUnique({
        where: { id: id },
      });
      if (!creditLevel || !tenantHotelReadMatches(context, creditLevel.HotelName)) {
        throw new Error("Credit Level not found or not authorized");
      }
      return await prisma.creditLevel.update({
        where: { id: id },
        data: {
          level,
          requiredAmount,
          timeInterval,
          timeFrame,
        },
      });
    },
    UpdatePityCash: async (_, { id, amount, startDate, endDate }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const pityCash = await prisma.pityCash.findUnique({
        where: { id: id },
      });
      if (!pityCash || !tenantHotelReadMatches(context, pityCash.HotelName)) {
        throw new Error("Pity Cash not found or not authorized");
      }
      return await prisma.pityCash.update({
        where: { id: id },
        data: {
          amount,
          startDate,
          endDate,
        },
      });
    },
    UpdateCreditRegistration: async (
      _,
      {
        id,
        imageUrl,
        name,
        sex,
        creditLevel,
        phoneNumber,
        amount,
        timeInterval,
        timeFrame,
        paidAmount,
        registrationDate,
      },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      const creditReg = await prisma.creditRegistration.findUnique({
        where: { id: id },
      });
      if (!creditReg || !tenantHotelReadMatches(context, creditReg.HotelName)) {
        throw new Error("Credit Registration not found or not authorized");
      }
      return await prisma.creditRegistration.update({
        where: { id: id },
        data: {
          name,
          imageUrl,
          sex,
          creditLevel,
          phoneNumber,
          amount,
          timeInterval,
          timeFrame,
          paidAmount,
          registrationDate,
        },
      });
    },
    UpdateItemRegistration: async (
      _,
      {
        id,
        name,
        imageUrl,
        category,
        amount,
        measuredBy,
        unitPrice,
        registrationDate,
        expireDate,
        dutyFee,
        supplierName,
        supplierPhone,
        Address,
        supplierLevel,
        purchaseWithVat,
        supplierTinNumber,
        paidAmount,
      },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      const itemReg = await prisma.itemRegistration.findUnique({
        where: { id: id },
      });
      if (!itemReg || !tenantHotelReadMatches(context, itemReg.HotelName)) {
        throw new Error("Item Registration not found or not authorized");
      }
      return await prisma.itemRegistration.update({
        where: { id: id },
        data: {
          name,
          imageUrl,
          category,
          amount,
          measuredBy,
          unitPrice,
          registrationDate,
          expireDate,
          dutyFee,
          supplierName,
          supplierPhone,
          Address,
          supplierLevel,
          purchaseWithVat: isVatEnabled(purchaseWithVat),
          supplierTinNumber: String(supplierTinNumber ?? "").trim(),
          paidAmount
        },
      });
    },
    createCostControllerProfile: async (_, { displayName }, context) => {
      assertRole(context, ["Manager"]);
      const tenant = tenantScopeFromContext(context);
      return await prisma.costControllerProfile.create({
        data: {
          displayName: String(displayName).trim(),
          HotelName: tenant,
        },
      });
    },
    deleteCostControllerProfile: async (_, { id }, context) => {
      assertRole(context, ["Manager"]);
      const row = await prisma.costControllerProfile.findUnique({
        where: { id },
      });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Profile not found");
      }
      await prisma.costControllerProfile.delete({ where: { id } });
      return true;
    },

    createPurchaseRequest: async (
      _,
      {
        itemName,
        quantity,
        measuredBy,
        notes,
        estimatedUnitPrice,
        supplierName,
        supplierPhone,
        category,
      },
      context,
    ) => {
      assertRole(context, ["Store"]);
      const tenant = tenantScopeFromContext(context);
      return await prisma.purchaseRequest.create({
        data: {
          HotelName: tenant,
          itemName: String(itemName).trim(),
          quantity,
          measuredBy,
          notes: notes ?? "",
          estimatedUnitPrice: estimatedUnitPrice ?? 0,
          supplierName: supplierName ?? "",
          supplierPhone: supplierPhone ?? "",
          category: category ?? "Others",
          status: "PENDING_CC",
          storeUserName: context.user.UserName,
        },
      });
    },

    approvePurchaseRequestCC: async (
      _,
      { id, costControllerProfileId },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      if (pr.status !== "PENDING_CC") {
        throw new Error("Request is not awaiting cost control approval");
      }
      const prof = await prisma.costControllerProfile.findFirst({
        where: {
          id: costControllerProfileId,
          HotelName: pr.HotelName,
        },
      });
      if (!prof) {
        throw new Error("Select a registered cost controller identity");
      }
      return await prisma.purchaseRequest.update({
        where: { id },
        data: {
          status: "PENDING_FINANCE",
          ccProfileId: prof.id,
          ccActorName: prof.displayName,
          ccApprovedAt: new Date(),
          rejectionReason: null,
        },
      });
    },

    rejectPurchaseRequestCC: async (_, { id, reason }, context) => {
      assertRole(context, ["CostControl"]);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      if (pr.status !== "PENDING_CC") {
        throw new Error("Request is not awaiting cost control approval");
      }
      return await prisma.purchaseRequest.update({
        where: { id },
        data: {
          status: "REJECTED_CC",
          rejectionReason: reason ?? "",
        },
      });
    },

    approvePurchaseRequestFinance: async (_, { id }, context) => {
      assertRole(context, ["Finance"]);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      if (pr.status !== "PENDING_FINANCE") {
        throw new Error("Request is not awaiting finance approval");
      }
      return await prisma.purchaseRequest.update({
        where: { id },
        data: {
          status: "APPROVED_FINANCE",
          financeApprovedAt: new Date(),
          financeActorName: context.user.UserName,
          rejectionReason: null,
        },
      });
    },

    rejectPurchaseRequestFinance: async (_, { id, reason }, context) => {
      assertRole(context, ["Finance"]);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      if (pr.status !== "PENDING_FINANCE") {
        throw new Error("Request is not awaiting finance approval");
      }
      return await prisma.purchaseRequest.update({
        where: { id },
        data: {
          status: "REJECTED_FINANCE",
          rejectionReason: reason ?? "",
        },
      });
    },

    createStockOutRequest: async (
      _,
      { itemRegistrationId, movementType, amount, stakeHolderOrReason },
      context,
    ) => {
      assertRole(context, ["Store"]);
      const item = await prisma.itemRegistration.findUnique({
        where: { id: itemRegistrationId },
      });
      if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
        throw new Error("Item not found");
      }
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Amount must be positive");
      const stakeText = String(stakeHolderOrReason ?? "").trim();
      const stakeKey = normalizeKitchenBarStation(stakeText);
      if (stakeKey === "MANAGEMENT") {
        throw new Error(
          "Management stock issue must be recorded from station daily count, not store stock-out.",
        );
      }
      if (item.amount - amt < 1) {
        throw new Error(
          "At least 1 unit must remain in stock for every item. Reduce the requested quantity.",
        );
      }
      const tenant = tenantScopeFromContext(context);
      return await prisma.stockOutRequest.create({
        data: {
          HotelName: tenant,
          itemRegistrationId,
          itemNameSnapshot: String(item.name ?? "").trim(),
          movementType: String(movementType),
          amount: amt,
          stakeHolderOrReason: stakeText,
          status: "PENDING",
          requestedByUserName: context.user.UserName,
        },
      });
    },

    approveStockOutRequest: async (
      _,
      { id, costControllerProfileId },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const reqRow = await prisma.stockOutRequest.findUnique({
        where: { id },
      });
      if (!reqRow || !tenantHotelReadMatches(context, reqRow.HotelName)) {
        throw new Error("Request not found");
      }
      if (reqRow.status !== "PENDING") {
        throw new Error("Request already processed");
      }
      const prof = await prisma.costControllerProfile.findFirst({
        where: {
          id: costControllerProfileId,
          HotelName: reqRow.HotelName,
        },
      });
      if (!prof) {
        throw new Error("Select a registered cost controller identity");
      }
      const item = await prisma.itemRegistration.findUnique({
        where: { id: reqRow.itemRegistrationId },
      });
      if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
        throw new Error("Source stock row missing");
      }
      if (item.amount - reqRow.amount < 1) {
        throw new Error(
          "Approval would violate minimum stock rule (≥1). Reject or adjust inventory.",
        );
      }
      const newAmt = item.amount - reqRow.amount;
      const statusLabel =
        reqRow.movementType === "STOCK_OUT"
          ? "Stock Out"
          : reqRow.movementType === "WASTAGE"
            ? "Wastage"
            : "Returned to Supplier";

      const decidedNow = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.itemStatus.create({
          data: {
            name: item.name,
            imageUrl: item.imageUrl,
            category: item.category,
            amount: reqRow.amount,
            measuredBy: item.measuredBy,
            unitPrice: item.unitPrice,
            actionDate: new Date(),
            supplierName: item.supplierName,
            supplierPhone: item.supplierPhone,
            Address: item.Address,
            supplierLevel: item.supplierLevel,
            purchaseWithVat: isVatEnabled(item.purchaseWithVat),
            supplierTinNumber: String(item.supplierTinNumber ?? "").trim(),
            paidAmount: item.paidAmount,
            status: statusLabel,
            statusBy: prof.displayName,
            HotelName: reqRow.HotelName,
          },
        });
        await tx.itemRegistration.update({
          where: { id: item.id },
          data: { amount: newAmt },
        });
        await tx.stockOutRequest.update({
          where: { id },
          data: {
            status: "APPROVED",
            ccProfileId: prof.id,
            ccActorName: prof.displayName,
            decidedAt: decidedNow,
            rejectionReason: null,
          },
        });
        if (reqRow.movementType === "STOCK_OUT") {
          await reconcileKitchenBarDailyRows(
            tx,
            reqRow.HotelName,
            String(item.name).trim(),
            reqRow.stakeHolderOrReason,
            decidedNow,
          );
        }
      });
      return await prisma.stockOutRequest.findUnique({ where: { id } });
    },

    rejectStockOutRequest: async (_, { id, reason }, context) => {
      assertRole(context, ["CostControl"]);
      const reqRow = await prisma.stockOutRequest.findUnique({
        where: { id },
      });
      if (!reqRow || !tenantHotelReadMatches(context, reqRow.HotelName)) {
        throw new Error("Request not found");
      }
      if (reqRow.status !== "PENDING") {
        throw new Error("Request already processed");
      }
      return await prisma.stockOutRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          decidedAt: new Date(),
          rejectionReason: reason ?? "",
        },
      });
    },

    createKitchenBarBeginning: async (
      _,
      {
        station,
        itemName,
        amount,
        measuredBy,
        managementTakenDay,
        monthPeriod,
        notes,
        calendarDate,
      },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const tenant = tenantScopeFromContext(context);
      const cal = String(calendarDate).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cal)) {
        throw new Error("calendarDate must be YYYY-MM-DD");
      }
      const mp =
        monthPeriod != null && String(monthPeriod).trim().length >= 7
          ? String(monthPeriod).trim().slice(0, 7)
          : monthPeriodFromCalendarDate(cal);
      const item = String(itemName).trim();
      const stationKey = normalizeKitchenBarStation(station);
      const inv = await prisma.itemRegistration.findFirst({
        where: {
          ...tenantHotelReadWhere(context),
          name: item,
        },
      });
      if (!inv || Number(inv.amount) <= 0) {
        throw new Error(
          "Select an item from active inventory. Daily count items must exist in stock.",
        );
      }
      const dup = await prisma.kitchenBarBeginning.findFirst({
        where: {
          HotelName: tenant,
          itemName: item,
          calendarDate: cal,
          ...kitchenBarStationPrismaWhere(stationKey),
        },
      });
      if (dup) {
        throw new Error(
          "A row already exists for this station, item, and calendar date.",
        );
      }
      const sum = await sumApprovedStockOutToStation(
        prisma,
        tenant,
        stationKey,
        item,
        cal,
      );
      const opening = round2(Number(amount));
      const mgmtTaken = round2(Number(managementTakenDay ?? 0));
      const prev = await findPreviousKitchenBarRow(
        prisma,
        tenant,
        stationKey,
        item,
        cal,
      );
      const closing = round2(computeClosingOnHand(opening, sum, mgmtTaken, prev));
      return await prisma.kitchenBarBeginning.create({
        data: {
          HotelName: tenant,
          station: stationKey,
          itemName: item,
          amount: opening,
          measuredBy: String(inv.measuredBy || measuredBy || "").trim(),
          monthPeriod: mp,
          calendarDate: cal,
          stockOutDay: round2(sum),
          managementTakenDay: mgmtTaken,
          closingOnHand: closing,
          notes: notes ?? "",
        },
      });
    },

    updateKitchenBarBeginning: async (
      _,
      {
        id,
        station,
        itemName,
        amount,
        measuredBy,
        managementTakenDay,
        monthPeriod,
        notes,
        calendarDate,
      },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const row = await prisma.kitchenBarBeginning.findUnique({
        where: { id },
      });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Record not found");
      }
      const cal = String(calendarDate).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cal)) {
        throw new Error("calendarDate must be YYYY-MM-DD");
      }
      const mp =
        monthPeriod != null && String(monthPeriod).trim().length >= 7
          ? String(monthPeriod).trim().slice(0, 7)
          : monthPeriodFromCalendarDate(cal);
      const item = String(itemName).trim();
      const stationKey = normalizeKitchenBarStation(station);
      const inv = await prisma.itemRegistration.findFirst({
        where: {
          ...tenantHotelReadWhere(context),
          name: item,
        },
      });
      if (!inv || Number(inv.amount) <= 0) {
        throw new Error(
          "Select an item from active inventory. Daily count items must exist in stock.",
        );
      }
      const dup = await prisma.kitchenBarBeginning.findFirst({
        where: {
          HotelName: row.HotelName,
          itemName: item,
          calendarDate: cal,
          NOT: { id },
          ...kitchenBarStationPrismaWhere(stationKey),
        },
      });
      if (dup) {
        throw new Error(
          "Another row already uses this station, item, and calendar date.",
        );
      }
      const sum = await sumApprovedStockOutToStation(
        prisma,
        row.HotelName,
        stationKey,
        item,
        cal,
      );
      const opening = round2(Number(amount));
      const mgmtTaken = round2(Number(managementTakenDay ?? 0));
      const prev = await findPreviousKitchenBarRow(
        prisma,
        row.HotelName,
        stationKey,
        item,
        cal,
      );
      const closing = round2(computeClosingOnHand(opening, sum, mgmtTaken, prev));
      return await prisma.kitchenBarBeginning.update({
        where: { id },
        data: {
          station: stationKey,
          itemName: item,
          amount: opening,
          measuredBy: String(inv.measuredBy || measuredBy || "").trim(),
          monthPeriod: mp,
          calendarDate: cal,
          stockOutDay: round2(sum),
          managementTakenDay: mgmtTaken,
          closingOnHand: closing,
          notes: notes ?? "",
        },
      });
    },

    deleteKitchenBarBeginning: async (_, { id }, context) => {
      assertRole(context, ["CostControl"]);
      const row = await prisma.kitchenBarBeginning.findUnique({
        where: { id },
      });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Record not found");
      }
      await prisma.kitchenBarBeginning.delete({ where: { id } });
      return true;
    },

    syncKitchenBarRollup: async (_, { fromYmd, toYmd }, context) => {
      assertRole(context, ["CostControl"]);
      const tenant = tenantScopeFromContext(context);
      const { fromYmd: from, toYmd: to, rangeKey } = normalizeRollupRangeYmd(
        fromYmd,
        toYmd,
      );
      const rows = await prisma.kitchenBarBeginning.findMany({
        where: {
          ...tenantHotelReadWhere(context),
          calendarDate: { gte: from, lte: to },
        },
      });
      const groups = new Map();
      for (const r of rows) {
        const key = `${normalizeKitchenBarStation(r.station)}\t${String(r.itemName).trim()}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      const results = [];
      for (const [, list] of groups) {
        list.sort((a, b) =>
          String(a.calendarDate).localeCompare(String(b.calendarDate)),
        );
        let totalImplied = 0;
        for (let i = 0; i < list.length - 1; i++) {
          const implied =
            Number(list[i].amount) +
            Number(list[i].stockOutDay) -
            Number(list[i + 1].amount);
          totalImplied += implied;
        }
        const last = list[list.length - 1];
        const closing =
          Number(last.closingOnHand) > 0
            ? Number(last.closingOnHand)
            : Number(last.amount);
        const itemName = String(last.itemName).trim();
        const station = normalizeKitchenBarStation(last.station);
        const existing = await prisma.kitchenBarMonthlySnapshot.findFirst({
          where: {
            HotelName: tenant,
            station,
            itemName,
            monthPeriod: rangeKey,
          },
        });
        const payload = {
          totalImpliedSales: totalImplied,
          lastDayClosingOnHand: closing,
          syncedAt: new Date(),
        };
        if (existing) {
          results.push(
            await prisma.kitchenBarMonthlySnapshot.update({
              where: { id: existing.id },
              data: payload,
            }),
          );
        } else {
          results.push(
            await prisma.kitchenBarMonthlySnapshot.create({
              data: {
                HotelName: tenant,
                station,
                itemName,
                monthPeriod: rangeKey,
                ...payload,
              },
            }),
          );
        }
      }
      return results;
    },

    createHotelCreditCompany: async (
      _,
      {
        companyName,
        contactName,
        phoneNumber,
        email,
        hotelCorporateCreditTierId,
        allowedMenuJson,
        dealNotes,
        imageUrl,
      },
      context,
    ) => {
      assertRole(context, ["HotelCashier"]);
      const tenant = tenantScopeFromContext(context);
      const tierId = Number(hotelCorporateCreditTierId);
      if (!tierId) throw new Error("Select a manager-defined credit tier");
      const tier = await prisma.hotelCorporateCreditTier.findUnique({
        where: { id: tierId },
      });
      if (!tier || !tenantHotelReadMatches(context, tier.HotelName)) {
        throw new Error("Credit tier not found");
      }
      return await prisma.hotelCreditCompany.create({
        data: {
          HotelName: tenant,
          companyName: String(companyName).trim(),
          contactName: contactName != null ? String(contactName) : "",
          phoneNumber: String(phoneNumber).trim(),
          email: email != null ? String(email).trim() : "",
          creditLevel: String(tier.name).trim(),
          creditLimit: Number(tier.creditCeiling),
          timeInterval: Number(tier.timeInterval),
          timeFrame: String(tier.timeFrame).trim(),
          hotelCorporateCreditTierId: tier.id,
          allowedMenuJson: String(allowedMenuJson || "[]"),
          dealNotes: dealNotes != null ? String(dealNotes) : "",
          imageUrl: imageUrl != null ? String(imageUrl) : "",
        },
      });
    },

    updateHotelCreditCompany: async (
      _,
      {
        id,
        companyName,
        contactName,
        phoneNumber,
        email,
        hotelCorporateCreditTierId,
        allowedMenuJson,
        dealNotes,
        imageUrl,
      },
      context,
    ) => {
      assertRole(context, ["HotelCashier"]);
      const row = await prisma.hotelCreditCompany.findUnique({
        where: { id },
      });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Company not found");
      }
      let tierPatch = {};
      if (hotelCorporateCreditTierId != null) {
        const tid = Number(hotelCorporateCreditTierId);
        const tier = await prisma.hotelCorporateCreditTier.findUnique({
          where: { id: tid },
        });
        if (!tier || !tenantHotelReadMatches(context, tier.HotelName)) {
          throw new Error("Credit tier not found");
        }
        tierPatch = {
          hotelCorporateCreditTierId: tier.id,
          creditLevel: String(tier.name).trim(),
          creditLimit: Number(tier.creditCeiling),
          timeInterval: Number(tier.timeInterval),
          timeFrame: String(tier.timeFrame).trim(),
        };
      }
      return await prisma.hotelCreditCompany.update({
        where: { id },
        data: {
          companyName: String(companyName).trim(),
          contactName: contactName != null ? String(contactName) : "",
          phoneNumber: String(phoneNumber).trim(),
          email: email != null ? String(email).trim() : "",
          allowedMenuJson: String(allowedMenuJson || "[]"),
          dealNotes: dealNotes != null ? String(dealNotes) : "",
          imageUrl: imageUrl != null ? String(imageUrl) : "",
          ...tierPatch,
        },
      });
    },

    deleteHotelCreditCompany: async (_, { id }, context) => {
      assertRole(context, ["HotelCashier", "Manager"]);
      const row = await prisma.hotelCreditCompany.findUnique({
        where: { id },
      });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Company not found");
      }
      await prisma.hotelCreditCompany.delete({ where: { id } });
      return true;
    },

    createHotelCreditParty: async (
      _,
      { companyId, displayName, phoneNumber, sex, notes },
      context,
    ) => {
      assertRole(context, ["HotelCashier"]);
      const cid = Number(companyId);
      const company = await prisma.hotelCreditCompany.findUnique({
        where: { id: cid },
      });
      if (!company || !tenantHotelReadMatches(context, company.HotelName)) {
        throw new Error("Company not found");
      }
      return await prisma.hotelCreditParty.create({
        data: {
          HotelName: company.HotelName,
          companyId: cid,
          displayName: String(displayName).trim(),
          phoneNumber: phoneNumber != null ? String(phoneNumber).trim() : "",
          sex: sex != null ? String(sex) : "",
          notes: notes != null ? String(notes) : "",
        },
      });
    },

    createHotelCreditConsumption: async (
      _,
      { companyId, partyId, guestName, guestPhone, linesJson, totalAmount, occurredAt },
      context,
    ) => {
      assertRole(context, ["HotelCashier"]);
      const cid = Number(companyId);
      const pid = partyId != null ? Number(partyId) : 0;
      const company = await prisma.hotelCreditCompany.findUnique({
        where: { id: cid },
      });
      if (!company || !tenantHotelReadMatches(context, company.HotelName)) {
        throw new Error("Company not found");
      }
      let party = null;
      if (pid > 0) {
        party = await prisma.hotelCreditParty.findFirst({
          where: {
            id: pid,
            companyId: cid,
            HotelName: company.HotelName,
          },
        });
      }
      if (!party) {
        const requestedName = String(guestName || "").trim();
        const fallbackName =
          requestedName || String(company.companyName || "").trim() || "Company";
        const fallbackPhone = String(guestPhone || company.phoneNumber || "").trim();
        party =
          (await prisma.hotelCreditParty.findFirst({
            where: {
              companyId: cid,
              HotelName: company.HotelName,
              displayName: fallbackName,
            },
          })) ||
          (await prisma.hotelCreditParty.create({
            data: {
              HotelName: company.HotelName,
              companyId: cid,
              displayName: fallbackName,
              phoneNumber: fallbackPhone,
              notes: "Auto-created default bill-to for company credit usage",
            },
          }));
      }

      let lines;
      try {
        lines = JSON.parse(String(linesJson || "[]"));
      } catch {
        throw new Error("linesJson must be valid JSON");
      }
      if (!Array.isArray(lines) || lines.length === 0) {
        throw new Error("At least one line item is required");
      }

      let allowed;
      try {
        allowed = JSON.parse(String(company.allowedMenuJson || "[]"));
      } catch {
        allowed = [];
      }
      if (!Array.isArray(allowed)) allowed = [];
      const allowedNames = new Set(
        allowed.map((a) =>
          String(a.name || a.title || "")
            .trim()
            .toLowerCase(),
        ),
      );

      const menuByLowerName = new Map();
      const menuById = new Map();
      for (const it of await prisma.item.findMany({
        where: { HotelName: company.HotelName },
      })) {
        const nm = String(it.name || "")
          .trim()
          .toLowerCase();
        if (nm) menuByLowerName.set(nm, it);
        menuById.set(it.id, it);
      }

      const normalizedLines = [];
      for (const line of lines) {
        const nm = String(line.name || "")
          .trim()
          .toLowerCase();
        if (!nm || !allowedNames.has(nm)) {
          throw new Error(`Item not on company deal list: ${line.name || ""}`);
        }
        const qty = Number(line.qty) || 0;
        if (qty <= 0) throw new Error(`Quantity must be positive for item: ${line.name || ""}`);
        const allowedEntry = allowed.find(
          (a) =>
            String(a.name || a.title || "")
              .trim()
              .toLowerCase() === nm,
        );
        const menuItem =
          (allowedEntry?.itemId != null ? menuById.get(Number(allowedEntry.itemId)) : null) ||
          menuByLowerName.get(nm) ||
          null;
        if (!menuItem) {
          throw new Error(`Menu item not found in database for: ${line.name || ""}`);
        }
        normalizedLines.push({
          name: String(menuItem.name || line.name).trim(),
          qty,
          unitPrice: round2(Number(menuItem.price) || 0),
        });
      }

      const winStart = hotelCreditWindowStart(
        company.timeInterval,
        company.timeFrame,
      );
      const prior = await prisma.hotelCreditConsumption.findMany({
        where: {
          companyId: cid,
          HotelName: company.HotelName,
          occurredAt: { gte: winStart },
        },
      });

      let spent = 0;
      for (const c of prior) {
        spent += Number(c.totalAmount) || 0;
      }

      // No max-servings cap: allowedMenuJson now only controls which items are allowed.

      const computedTotal = normalizedLines.reduce(
        (s, l) => s + Number(l.qty) * Number(l.unitPrice),
        0,
      );
      const add = round2(computedTotal);
      if (spent + add > Number(company.creditLimit) + 1e-6) {
        throw new Error(
          "Company credit ceiling reached for this period — cannot register more.",
        );
      }

      const me = await prisma.user.findUnique({
        where: { id: context.user.userId },
      });
      const recordedBy = me?.UserName || "unknown";

      return await prisma.hotelCreditConsumption.create({
        data: {
          HotelName: company.HotelName,
          companyId: cid,
          partyId: party.id,
          linesJson: JSON.stringify(normalizedLines),
          totalAmount: add,
          occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
          recordedBy,
        },
      });
    },

    createHotelCorporateCreditTier: async (
      _,
      { name, creditCeiling, timeInterval, timeFrame, sortOrder },
      context,
    ) => {
      assertRole(context, ["Manager"]);
      const tenant = tenantScopeFromContext(context);
      return await prisma.hotelCorporateCreditTier.create({
        data: {
          HotelName: tenant,
          name: String(name).trim(),
          creditCeiling: Number(creditCeiling),
          timeInterval: Number(timeInterval),
          timeFrame: String(timeFrame).trim(),
          sortOrder: sortOrder != null ? Number(sortOrder) : 0,
        },
      });
    },

    updateHotelCorporateCreditTier: async (
      _,
      { id, name, creditCeiling, timeInterval, timeFrame, sortOrder },
      context,
    ) => {
      assertRole(context, ["Manager"]);
      const row = await prisma.hotelCorporateCreditTier.findUnique({
        where: { id },
      });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Tier not found");
      }
      return await prisma.hotelCorporateCreditTier.update({
        where: { id },
        data: {
          name: String(name).trim(),
          creditCeiling: Number(creditCeiling),
          timeInterval: Number(timeInterval),
          timeFrame: String(timeFrame).trim(),
          sortOrder: sortOrder != null ? Number(sortOrder) : row.sortOrder,
        },
      });
    },

    deleteHotelCorporateCreditTier: async (_, { id }, context) => {
      assertRole(context, ["Manager"]);
      const row = await prisma.hotelCorporateCreditTier.findUnique({
        where: { id },
      });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Tier not found");
      }
      await prisma.hotelCorporateCreditTier.delete({ where: { id } });
      return true;
    },

    CreateItemStatus: async(_, {name, imageUrl, category, amount, measuredBy, unitPrice, actionDate, supplierName, supplierPhone, Address, supplierLevel, purchaseWithVat, supplierTinNumber, paidAmount, status, statusBy}, context) => {
      if (!context.user) throw new Error("Not Authorized")
      return await prisma.itemStatus.create({
        data: {
          name: name,
          imageUrl: imageUrl,
          category: category,
          amount: amount,
          measuredBy: measuredBy,
          unitPrice: unitPrice,
          actionDate: actionDate,
          supplierName: supplierName,
          supplierPhone: supplierPhone,
          Address: Address,
          supplierLevel: supplierLevel,
          purchaseWithVat: isVatEnabled(purchaseWithVat),
          supplierTinNumber: String(supplierTinNumber ?? "").trim(),
          paidAmount: paidAmount,
          status: status,
          statusBy: statusBy,
          HotelName: tenantScopeFromContext(context),
        },
      });
    },
    DeleteItemStatus: async (_, {id}, context) => {
      if (!context.user) throw new Error("Not Authorized")
      const itemStatus = await prisma.itemStatus.findUnique({
        where: {id: id}
      })
      if (!itemStatus || !tenantHotelReadMatches(context, itemStatus.HotelName)) {
        throw new Error("Item Status not found or not authorized");
      }
      return await prisma.itemStatus.delete({
        where: { id: id },
      });
    }
  },
};

async function startServer() {
  const app = express();
  app.use(cors());

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }) => {
      const user = authenticate(req);
      return { user, prisma };
    },
  });

  await server.start();
  server.applyMiddleware({ app, path: "/graphql" });

  app.get("/health", (req, res) => {
    res.status(200).json({
      status: "OK",
      timestamp: new Date().toISOString(),
      service: "GraphQL API",
    });
  });

  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

startServer();
