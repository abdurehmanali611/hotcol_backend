import express from "express";
import { ApolloServer, gql } from "apollo-server-express";
import cors from "cors";
import crypto from "crypto";
import { createPrismaClient } from "./lib/prismaClient.js";
import { isSameCafeBusinessDay } from "./cafeBusinessDay.js";
import {
  isBarStationOrder,
  isKitchenStationOrder,
} from "./lib/cafeOrderStation.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { DateTimeResolver, GraphQLJSON } from "graphql-scalars";
import {
  allocateVoucherNumber,
  formatVoucherNumber,
  VOUCHER_TYPES,
} from "./lib/hotelVoucher.js";
import { requireRejectionReason } from "./lib/hotelRejection.js";
import {
  PENDING_STORE,
  assertStoreUser,
  matchesStoreOwner,
  assertPurchasePendingStore,
  assertStockPendingStore,
  assertRegistrationPendingStore,
} from "./lib/storeDraftWorkflow.js";
import {
  isPurchaseRequestAuthorized,
  itemRegistrationInventoryWhere,
  itemRegistrationStoreReadWhere,
  isCompanyAuthorized,
  normalizeStockOutStatus,
  isStockOutPendingCC,
  isStockOutPendingFinance,
  isStockOutPendingManager,
  ITEM_REG_VOID,
  isItemRegistrationActive,
} from "./lib/hotelWorkflow.js";
import {
  computeQuarterEndFromCreatedAt,
  daysBetweenCalendar,
  paidQuartersFromCreatedAt,
  parseModulesJson,
} from "./lib/subscriptionPricing.js";
import {
  calculateSignupPricing,
  resolveSignupPricing,
} from "./lib/pricingRules.js";
import {
  computeSubscriptionPeriodStatus,
  resolveLoginAccess,
  subscriptionAllowsFullSystemAccess,
  tenantBillingRowFromOwner,
  resolveBillingAnchor,
} from "./lib/tenantBilling.js";

function computeQuarterEndFromRegistration(createdAt, paidQuartersCount) {
  return computeQuarterEndFromCreatedAt(createdAt, paidQuartersCount);
}

const prisma = createPrismaClient();
const JWT_Secret = process.env.JWT_Secret;
/** Default 1d — set JWT_EXPIRES_IN in env to override (e.g. "7d", "30d"). */
const JWT_EXPIRES_IN =
  process.env.JWT_EXPIRES_IN != null &&
  String(process.env.JWT_EXPIRES_IN).trim() !== ""
    ? String(process.env.JWT_EXPIRES_IN).trim()
    : "1d";

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

function computeInventoryTotalETB({ amount, unitPrice, purchaseWithVat }) {
  const qty = Number(amount) || 0;
  const price = Number(unitPrice) || 0;
  return computeInventoryPaidAmountETB(qty, price, purchaseWithVat);
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

const ROLE_REQUIRED_MODULE = {
  Kitchen: "Cafe and Restaurant",
  Barista: "Cafe and Restaurant",
  Cashier: "Cafe and Restaurant",
  Store: "Inventory",
  CostControl: "Financial Management",
  Finance: "Financial Management",
  HotelCashier: "Credit Management",
};

function tenantHasModule(modules, required) {
  if (!Array.isArray(modules) || modules.length === 0) return true;
  return modules.includes(required);
}

function roleAllowedForModules(role, modules) {
  const required = ROLE_REQUIRED_MODULE[role];
  if (!required) return true;
  return tenantHasModule(modules, required);
}

const SUBSCRIPTION_WARNING_DAYS = 10;
const SUBSCRIPTION_GRACE_DAYS = 10;

function quarterlyFeeApplies(quarterlyFeeETB) {
  return Number(quarterlyFeeETB) > 0;
}

async function tenantTinFromUser(user) {
  if (user.tinNumber != null && String(user.tinNumber).trim() !== "") {
    return String(user.tinNumber).trim();
  }
  return String(user.HotelName).trim();
}

async function createPaymentSubmission(
  prismaClient,
  {
    tinNumber,
    paymentKind,
    amountETB,
    paymentChannel,
    transactionRef,
    submittedByUserId,
    quarterNumber,
  },
) {
  await prismaClient.tenant_payment_submission.updateMany({
    where: {
      tinNumber,
      paymentKind,
      status: "pending",
    },
    data: { status: "rejected" },
  });

  return prismaClient.tenant_payment_submission.create({
    data: {
      tinNumber,
      paymentKind,
      amountETB,
      paymentChannel: String(paymentChannel).trim(),
      transactionRef: String(transactionRef).trim(),
      submittedByUserId,
      quarterNumber: quarterNumber ?? null,
      status: "pending",
    },
  });
}

async function resolveTenantSubscription(prismaClient, user) {
  const tin =
    user.tinNumber != null && String(user.tinNumber).trim() !== ""
      ? String(user.tinNumber).trim()
      : "";
  const orClauses = [{ id: user.id }];
  if (tin) orClauses.push({ tinNumber: tin });
  else if (user.HotelName) orClauses.push({ HotelName: user.HotelName });

  const owner =
    (await prismaClient.user.findFirst({
      where: {
        OR: orClauses,
        Role: { in: ["Admin", "Manager"] },
      },
      orderBy: { id: "asc" },
    })) || user;

  const row = owner;
  const billing = tenantBillingRowFromOwner(row);
  return {
    ...billing,
    modules: parseModulesJson(row.modules),
  };
}

function attachSubscriptionFields(user, subscription) {
  return {
    ...user,
    modules: subscription.modules,
    setupFeeETB: subscription.setupFeeETB,
    quarterlyFeeETB: subscription.quarterlyFeeETB,
    setupFeeApproved: subscription.setupFeeApproved,
    createdAt: subscription.createdAt,
    billingStartedAt: subscription.billingStartedAt,
    billingHold: subscription.billingHold,
    isIllustrationTenant: subscription.isIllustrationTenant,
    freeTrialEndsAt: subscription.freeTrialEndsAt,
    billingNotes: subscription.billingNotes,
    subscriptionPaidUntil: subscription.subscriptionPaidUntil,
    subscriptionPaymentApproved: subscription.subscriptionPaymentApproved,
    paidQuartersCount: subscription.paidQuartersCount,
  };
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

async function serviceCaptionForTableNo(tableNo, context) {
  const keys = tenantHotelKeysFromContext(context);
  if (keys.length === 0) return null;
  const tableWhere =
    keys.length === 1
      ? { tableNo: Number(tableNo), HotelName: keys[0] }
      : { tableNo: Number(tableNo), HotelName: { in: keys } };
  const row = await prisma.table.findFirst({
    where: tableWhere,
    select: { orderCaption: true },
  });
  const caption =
    row?.orderCaption != null ? String(row.orderCaption).trim() : "";
  return caption || null;
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

function tenantHotelKeysFromContext(ctx) {
  const where = tenantHotelReadWhere(ctx);
  if (where.HotelName) return [where.HotelName];
  if (where.OR) return where.OR.map((c) => c.HotelName).filter(Boolean);
  return [];
}

function isLodgingBusiness(ctx) {
  const bt = String(ctx?.user?.businessType ?? "").trim();
  return bt === "Hotel" || bt === "Resort" || bt === "Pension";
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
    setupFeeETB: Int
    quarterlyFeeETB: Int
    paymentChannel: String
    paymentTransactionRef: String
    createdAt: DateTime
    subscriptionPaidUntil: DateTime
    subscriptionPaymentApproved: Boolean
    setupFeeApproved: Boolean
    paidQuartersCount: Int
    isIllustrationTenant: Boolean
    billingHold: Boolean
    billingStartedAt: DateTime
    freeTrialEndsAt: DateTime
    billingNotes: String
    Role: String!
    LogoUrl: String
  }

  type TenantPaymentSubmission {
    id: Int!
    tinNumber: String!
    paymentKind: String!
    amountETB: Int!
    paymentChannel: String!
    transactionRef: String!
    status: String!
    submittedAt: DateTime!
    approvedAt: DateTime
    quarterNumber: Int
  }

  type AuthPayload {
    token: String!
    user: User!
    accessMode: String!
    paymentKind: String
  }

  type TenantFeedbackMessage {
    id: Int!
    threadId: Int!
    senderSide: String!
    tenantUserId: Int
    tenantUserName: String
    tenantRole: String
    apexMemberId: Int
    apexDisplayName: String
    body: String!
    imageUrl: String
    readByTenant: Boolean!
    readByApex: Boolean!
    createdAt: DateTime!
  }

  type TenantFeedbackInbox {
    threadId: Int!
    unreadFromApex: Int!
    messages: [TenantFeedbackMessage!]!
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
    serviceCaption: String
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

  """One line in a multi-item purchase request (shared voucher per batch)."""
  input PurchaseRequestLineInput {
    itemName: String!
    quantity: Float!
    measuredBy: String!
    notes: String
    estimatedUnitPrice: Float
    supplierName: String
    supplierPhone: String
    category: String
  }

  """One line in a multi-item registration (shared voucher per batch)."""
  input ItemRegistrationLineInput {
    name: String!
    imageUrl: String!
    category: String!
    amount: Float!
    measuredBy: String!
    unitPrice: Float!
    registrationDate: DateTime!
    expireDate: DateTime!
    supplierName: String!
    supplierPhone: String!
    Address: String!
    purchaseWithVat: Boolean
    supplierTinNumber: String
    paidAmount: Float!
    purchaseRequestId: Int
  }

  """One line in a multi-item stock movement batch (shared voucher per batch)."""
  input StockOutRequestLineInput {
    itemRegistrationId: Int!
    movementType: String!
    amount: Float!
    stakeHolderOrReason: String!
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
    orderCaption: String
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
    registrantType: String!
    approvalStatus: String!
    companyTinNumber: String!
    affiliatedCompany: String!
    rejectionReason: String
    adminActorName: String
    adminAuthorizedAt: DateTime
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
    supplierName: String!
    supplierPhone: String!
    Address: String!
    purchaseWithVat: Boolean!
    supplierTinNumber: String!
    paidAmount: Float!
    registeredAmount: Float!
    registeredValue: Float!
    statusBy: String
    HotelName: String!
    voucherNumber: Int
    voucherDisplay: String
    purchaseRequestId: Int
    approvalStatus: String!
    ccProfileId: Int
    ccActorName: String
    ccCheckedAt: DateTime
    financeActorName: String
    financeApprovedAt: DateTime
    managerActorName: String
    managerAuthorizedAt: DateTime
    rejectionReason: String
    pendingUnitPrice: Float
    unitPriceChangeStatus: String
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
    purchaseWithVat: Boolean!
    supplierTinNumber: String!
    paidAmount: Float!
    status: String!
    statusBy: String!
    HotelName: String!
    voucherNumber: Int
    voucherDisplay: String
    stockOutRequestId: Int
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
    voucherNumber: Int
    voucherDisplay: String
    ccProfileId: Int
    ccActorName: String
    ccApprovedAt: DateTime
    financeActorName: String
    financeApprovedAt: DateTime
    managerActorName: String
    managerAuthorizedAt: DateTime
    rejectionReason: String
    pendingUnitPrice: Float
    unitPriceChangeStatus: String
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
    voucherNumber: Int
    voucherDisplay: String
    requestedByUserName: String!
    ccProfileId: Int
    ccActorName: String
    ccCheckedAt: DateTime
    financeActorName: String
    financeApprovedAt: DateTime
    managerActorName: String
    managerAuthorizedAt: DateTime
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
    companyTinNumber: String!
    contactName: String!
    phoneNumber: String!
    email: String!
    payTiming: String!
    approvalStatus: String!
    managerActorName: String
    managerAuthorizedAt: DateTime
    rejectionReason: String
    creditLevel: String!
    creditLimit: Float!
    timeInterval: Int!
    timeFrame: String!
    hotelCorporateCreditTierId: Int
    allowedMenuJson: String!
    dealNotes: String!
    imageUrl: String!
    paidAmount: Float!
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
    tenantFeedbackInbox(limit: Int): TenantFeedbackInbox!
    signupPricingPreview(businessType: String!, modules: JSON!): SignupPricingPreview!
  }

  type SignupPricingPreview {
    setupFeeETB: Int!
    quarterlyFeeETB: Int!
    source: String!
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
      setupFeeETB: Int
      quarterlyFeeETB: Int
      paymentChannel: String
      paymentTransactionRef: String
    ): User!
    ApproveTenantQuarterPayment(tinNumber: String!): User!
    ApproveTenantSetupPayment(tinNumber: String!): User!
    ReleaseTenantBillingHold(tinNumber: String!): User!
    SubmitTenantPayment(
      paymentKind: String!
      paymentChannel: String!
      transactionRef: String!
    ): TenantPaymentSubmission!
    sendTenantFeedbackMessage(body: String, imageUrl: String): TenantFeedbackMessage!
    markTenantFeedbackRead: Boolean!
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
    UpdateLiveOrder(
      id: Int!
      tableNo: Int
      waiterName: String
      orderAmount: Int
      title: String
    ): Order!
    CreateWaiter(
      name: String!
      age: Int!
      sex: String!
      experience: Int!
      phoneNumber: String!
      HotelName: String!
    ): waiter!
    CreateTable(
      tableNo: Int!
      capacity: Int!
      HotelName: String!
      orderCaption: String
    ): table!
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
    UpdateTable(
      id: Int!
      tableNo: Int!
      capacity: Int!
      orderCaption: String
    ): table!
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
      registrantType: String
      companyTinNumber: String
      affiliatedCompany: String
    ): CreditRegistration!
    AuthorizeCreditRegistration(id: Int!): CreditRegistration!
    RejectCreditRegistration(id: Int!, reason: String): CreditRegistration!
    ItemRegistration(
      name: String!
      imageUrl: String!
      category: String!
      amount: Float!
      measuredBy: String!
      unitPrice: Float!
      registrationDate: DateTime!
      expireDate: DateTime!
      supplierName: String!
      supplierPhone: String!
      Address: String!
      purchaseWithVat: Boolean
      supplierTinNumber: String
      paidAmount: Float!
      HotelName: String!
      purchaseRequestId: Int
      """Reuse an already-allocated voucher (e.g. other lines in the same batch)."""
      voucherNumber: Int
    ): ItemRegistration!

    """Register multiple items at once — one voucher number for the whole batch."""
    createItemRegistrationsBatch(lines: [ItemRegistrationLineInput!]!): [ItemRegistration!]!

    submitItemRegistrationsToCostControl(ids: [Int!]!): [ItemRegistration!]!

    checkItemRegistrationCC(id: Int!, costControllerProfileId: Int!): ItemRegistration!
    rejectItemRegistrationCC(id: Int!, reason: String): ItemRegistration!
    approveItemRegistrationFinance(id: Int!): ItemRegistration!
    rejectItemRegistrationFinance(id: Int!, reason: String): ItemRegistration!
    authorizeItemRegistrationManager(id: Int!): ItemRegistration!
    rejectItemRegistrationManager(id: Int!, reason: String): ItemRegistration!
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
      supplierName: String!
      supplierPhone: String!
      Address: String!
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

    """Submit multiple purchase lines at once — one voucher number for the whole batch."""
    createPurchaseRequestsBatch(lines: [PurchaseRequestLineInput!]!): [PurchaseRequest!]!

    updatePurchaseRequestStoreDraft(
      id: Int!
      itemName: String
      quantity: Float
      measuredBy: String
      notes: String
      estimatedUnitPrice: Float
      supplierName: String
      supplierPhone: String
      category: String
    ): PurchaseRequest!

    deletePurchaseRequestStoreDraft(id: Int!): Boolean!

    submitPurchaseRequestsToCostControl(ids: [Int!]!): [PurchaseRequest!]!

    approvePurchaseRequestCC(id: Int!, costControllerProfileId: Int!): PurchaseRequest!
    approvePurchaseRequestsCCBatch(ids: [Int!]!, costControllerProfileId: Int!): [PurchaseRequest!]!
    rejectPurchaseRequestCC(id: Int!, reason: String): PurchaseRequest!
    rejectPurchaseRequestsCCBatch(ids: [Int!]!, reason: String): [PurchaseRequest!]!

    approvePurchaseRequestFinance(id: Int!): PurchaseRequest!
    approvePurchaseRequestsFinanceBatch(ids: [Int!]!): [PurchaseRequest!]!
    rejectPurchaseRequestFinance(id: Int!, reason: String): PurchaseRequest!
    rejectPurchaseRequestsFinanceBatch(ids: [Int!]!, reason: String): [PurchaseRequest!]!

    authorizePurchaseRequestManager(id: Int!): PurchaseRequest!
    rejectPurchaseRequestManager(id: Int!, reason: String): PurchaseRequest!

    submitPurchaseRequestUnitPriceChange(id: Int!, proposedUnitPrice: Float!): PurchaseRequest!
    checkPurchaseRequestUnitPriceCC(id: Int!, costControllerProfileId: Int!): PurchaseRequest!
    approvePurchaseRequestUnitPriceFinance(id: Int!): PurchaseRequest!
    authorizePurchaseRequestUnitPriceManager(id: Int!): PurchaseRequest!
    rejectPurchaseRequestUnitPrice(id: Int!, reason: String): PurchaseRequest!

    submitItemRegistrationUnitPriceChange(id: Int!, proposedUnitPrice: Float!): ItemRegistration!
    checkItemRegistrationUnitPriceCC(id: Int!, costControllerProfileId: Int!): ItemRegistration!
    approveItemRegistrationUnitPriceFinance(id: Int!): ItemRegistration!
    authorizeItemRegistrationUnitPriceManager(id: Int!): ItemRegistration!
    rejectItemRegistrationUnitPrice(id: Int!, reason: String): ItemRegistration!

    createStockOutRequest(
      itemRegistrationId: Int!
      movementType: String!
      amount: Float!
      stakeHolderOrReason: String!
    ): StockOutRequest!

    """Submit multiple stock movements at once — one voucher number for the whole batch."""
    createStockOutRequestsBatch(lines: [StockOutRequestLineInput!]!): [StockOutRequest!]!

    updateStockOutRequestStoreDraft(
      id: Int!
      movementType: String
      amount: Float
      stakeHolderOrReason: String
    ): StockOutRequest!

    deleteStockOutRequestStoreDraft(id: Int!): Boolean!

    submitStockOutRequestsToCostControl(ids: [Int!]!): [StockOutRequest!]!

    checkStockOutRequestCC(id: Int!, costControllerProfileId: Int!): StockOutRequest!
    approveStockOutRequestsBatch(ids: [Int!]!, costControllerProfileId: Int!): [StockOutRequest!]!
    rejectStockOutRequestsBatch(ids: [Int!]!, reason: String): [StockOutRequest!]!
    approveStockOutRequestFinance(id: Int!): StockOutRequest!
    authorizeStockOutRequestManager(id: Int!): StockOutRequest!
    rejectStockOutRequest(id: Int!, reason: String): StockOutRequest!
    """@deprecated Use checkStockOutRequestCC"""
    approveStockOutRequest(id: Int!, costControllerProfileId: Int!): StockOutRequest!

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
      companyTinNumber: String
      contactName: String
      phoneNumber: String
      email: String
      payTiming: String
      hotelCorporateCreditTierId: Int!
      allowedMenuJson: String!
      dealNotes: String
      imageUrl: String
      creditLimit: Float
      paidAmount: Float
    ): HotelCreditCompany!

    updateHotelCreditCompany(
      id: Int!
      companyName: String!
      companyTinNumber: String
      contactName: String
      phoneNumber: String
      email: String
      payTiming: String
      hotelCorporateCreditTierId: Int
      allowedMenuJson: String!
      dealNotes: String
      imageUrl: String
      creditLimit: Float
      paidAmount: Float
    ): HotelCreditCompany!

    authorizeHotelCreditCompany(id: Int!): HotelCreditCompany!
    rejectHotelCreditCompany(id: Int!, reason: String): HotelCreditCompany!

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
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      return { __authExpired: true };
    }
    return null;
  }
};

function assertAuthenticated(context) {
  if (!context.user) throw new Error("Not Authenticated");
  if (context.user.__authExpired) {
    throw new Error("JWT expired");
  }
}

function normalizeRoleName(role) {
  return String(role ?? "").trim();
}

function roleIsOneOf(user, allowedRoles) {
  const role = normalizeRoleName(user?.Role ?? user?.role).toLowerCase();
  return allowedRoles.some(
    (allowed) => normalizeRoleName(allowed).toLowerCase() === role,
  );
}

/** Kitchen/Bar may cancel only their station's queue; cashier+ can cancel any live line. */
function canCancelLiveOrder(user, order) {
  if (roleIsOneOf(user, ["Cashier", "Admin", "Manager"])) return true;
  if (roleIsOneOf(user, ["Kitchen", "Chef"])) return isKitchenStationOrder(order);
  if (roleIsOneOf(user, ["Barista", "Bar"])) return isBarStationOrder(order);
  return false;
}

function canCompleteLiveOrder(user, order) {
  if (roleIsOneOf(user, ["Cashier", "Admin", "Manager"])) return true;
  if (roleIsOneOf(user, ["Kitchen", "Chef"])) return isKitchenStationOrder(order);
  if (roleIsOneOf(user, ["Barista", "Bar"])) return isBarStationOrder(order);
  return false;
}

async function loadAuthUserFromDb(ctx, prismaClient) {
  const userId = Number(ctx?.user?.userId);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  return prismaClient.user.findUnique({
    where: { id: userId },
    select: { id: true, Role: true, HotelName: true, tinNumber: true },
  });
}

/** Prefer DB role/tenant fields — JWT can be stale after credential edits. */
function enrichContextUser(ctx, dbUser) {
  if (!ctx?.user) return ctx;
  if (!dbUser) return ctx;
  const tin =
    dbUser.tinNumber != null && String(dbUser.tinNumber).trim() !== ""
      ? String(dbUser.tinNumber).trim()
      : "";
  const tenantId =
    (ctx.user.tenantId != null && String(ctx.user.tenantId).trim() !== ""
      ? String(ctx.user.tenantId).trim()
      : "") ||
    tin ||
    String(dbUser.HotelName ?? "").trim();
  return {
    ...ctx,
    user: {
      ...ctx.user,
      Role: dbUser.Role ?? ctx.user.Role ?? ctx.user.role,
      HotelName: dbUser.HotelName ?? ctx.user.HotelName,
      tinNumber: dbUser.tinNumber ?? ctx.user.tinNumber,
      tenantId,
    },
  };
}

function assertRole(context, allowed) {
  assertAuthenticated(context);
  if (!roleIsOneOf(context.user, allowed)) {
    throw new Error("Not authorized");
  }
}

/** Same tenant filter used by `orders` query — avoids update failing on legacy HotelName values. */
function tenantScopedRowWhere(ctx, extra = {}) {
  const keys = tenantHotelKeysFromContext(ctx);
  if (keys.length === 0) {
    return { ...extra, HotelName: "__no_scope__" };
  }
  if (keys.length === 1) {
    return { ...extra, HotelName: keys[0] };
  }
  return { ...extra, HotelName: { in: keys } };
}

async function findTenantOrderById(ctx, prismaClient, id) {
  const orderId = Number(id);
  if (!Number.isFinite(orderId) || orderId <= 0) return null;
  const scope = tenantHotelReadWhere(ctx);
  if (
    scope.HotelName === "__no_user__" ||
    scope.HotelName === "__no_scope__"
  ) {
    return null;
  }
  const tenantClause = scope.OR
    ? { OR: scope.OR }
    : { HotelName: scope.HotelName };
  return prismaClient.order.findFirst({
    where: {
      AND: [{ id: orderId }, tenantClause],
    },
  });
}

function assertAdminOrManager(context) {
  assertRole(context, ["Admin", "Manager"]);
}

async function getOrCreateFeedbackThread(context) {
  assertAdminOrManager(context);
  const tin = tenantScopeFromContext(context);
  if (!tin) throw new Error("Tenant scope missing");

  let thread = await prisma.tenant_feedback_thread.findUnique({
    where: { tinNumber: tin },
  });

  if (!thread) {
    thread = await prisma.tenant_feedback_thread.create({
      data: {
        tinNumber: tin,
        hotelDisplayName: String(context.user.HotelName || "").trim() || tin,
        businessType: context.user.businessType ?? null,
      },
    });
  }

  return thread;
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

function withVoucherDisplay(row) {
  if (!row) return row;
  const n = row.voucherNumber;
  return {
    ...row,
    voucherDisplay:
      n != null && Number(n) > 0 ? formatVoucherNumber(n) : null,
  };
}

function uniquePositiveIds(ids) {
  return [...new Set((ids || []).map((id) => Math.floor(Number(id))).filter((id) => id > 0))];
}

async function allocateSharedVoucherForTenant(prisma, context, legacyType) {
  const tenant = tenantScopeFromContext(context);
  const { voucherNumber } = await allocateVoucherNumber(
    prisma,
    tenant,
    legacyType,
    tenantHotelKeysFromContext(context),
  );
  return { tenant, voucherNumber };
}

async function applyStockOutToInventory(tx, reqRow, actorName) {
  const item = await tx.itemRegistration.findUnique({
    where: { id: reqRow.itemRegistrationId },
  });
  if (!item || item.HotelName !== reqRow.HotelName) {
    throw new Error("Source stock row missing");
  }
  if (item.amount - reqRow.amount < 1) {
    throw new Error(
      "Approval would violate minimum stock rule (≥1). Reject or adjust inventory.",
    );
  }
  const statusLabel =
    reqRow.movementType === "STOCK_OUT"
      ? "Stock Out"
      : reqRow.movementType === "WASTAGE"
        ? "Wastage"
        : "Returned to Supplier";
  const decidedNow = new Date();
  await tx.itemStatus.create({
    data: {
      name: item.name,
      imageUrl: item.imageUrl,
      category: item.category,
      amount: reqRow.amount,
      measuredBy: item.measuredBy,
      unitPrice: item.unitPrice,
      actionDate: decidedNow,
      supplierName: item.supplierName,
      supplierPhone: item.supplierPhone,
      Address: item.Address,
      purchaseWithVat: isVatEnabled(item.purchaseWithVat),
      supplierTinNumber: String(item.supplierTinNumber ?? "").trim(),
      paidAmount: item.paidAmount,
      status: statusLabel,
      statusBy: actorName,
      HotelName: reqRow.HotelName,
      voucherNumber: reqRow.voucherNumber ?? null,
      stockOutRequestId: reqRow.id,
    },
  });
  await tx.itemRegistration.update({
    where: { id: item.id },
    data: { amount: item.amount - reqRow.amount },
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
  return decidedNow;
}

const resolvers = {
  JSON: GraphQLJSON,
  DateTime: DateTimeResolver,
  KitchenBarMonthlySnapshot: {
    periodFrom: (p) => periodBoundsFromSnapshotMonthPeriod(p.monthPeriod).from,
    periodTo: (p) => periodBoundsFromSnapshotMonthPeriod(p.monthPeriod).to,
  },
  PurchaseRequest: {
    voucherDisplay: (p) =>
      p.voucherNumber != null && Number(p.voucherNumber) > 0
        ? formatVoucherNumber(p.voucherNumber)
        : null,
  },
  ItemRegistration: {
    voucherDisplay: (p) =>
      p.voucherNumber != null && Number(p.voucherNumber) > 0
        ? formatVoucherNumber(p.voucherNumber)
        : null,
  },
  ItemStatus: {
    voucherDisplay: (p) =>
      p.voucherNumber != null && Number(p.voucherNumber) > 0
        ? formatVoucherNumber(p.voucherNumber)
        : null,
  },
  StockOutRequest: {
    voucherDisplay: (p) =>
      p.voucherNumber != null && Number(p.voucherNumber) > 0
        ? formatVoucherNumber(p.voucherNumber)
        : null,
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
      const rows = await prisma.creditRegistration.findMany({
        where: tenantHotelReadWhere(context),
      });
      const role = String(context.user.Role || "");
      if (role === "Cashier") {
        return rows.filter((r) => {
          const s = String(r.approvalStatus || "").trim().toUpperCase();
          return !s || s === "AUTHORIZED";
        });
      }
      return rows;
    },
    ItemRegistration: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const tenantWhere = tenantHotelReadWhere(context);
      const role = String(context.user.Role || "");
      const where =
        role === "Store"
          ? { AND: [tenantWhere, itemRegistrationStoreReadWhere()] }
          : tenantWhere;
      const rows = await prisma.itemRegistration.findMany({
        where,
        orderBy: [{ registrationDate: "asc" }, { id: "asc" }],
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
          purchaseWithVat: r.purchaseWithVat,
        });
        return withVoucherDisplay({
          ...r,
          registeredAmount,
          registeredValue,
        });
      });
    },
    ItemStatus: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const rows = await prisma.itemStatus.findMany({
        where: tenantHotelReadWhere(context),
        orderBy: { actionDate: "desc" },
      });
      return rows.map(withVoucherDisplay);
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
      const rows = await prisma.purchaseRequest.findMany({
        where: tenantHotelReadWhere(context),
        orderBy: { createdAt: "asc" },
      });
      return rows.map(withVoucherDisplay);
    },
    stockOutRequests: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const rows = await prisma.stockOutRequest.findMany({
        where: tenantHotelReadWhere(context),
        orderBy: { createdAt: "asc" },
      });
      return rows.map((r) =>
        withVoucherDisplay({
          ...r,
          status: normalizeStockOutStatus(r.status),
        }),
      );
    },
    kitchenBarBeginnings: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
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

    tenantFeedbackInbox: async (_, { limit }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const thread = await getOrCreateFeedbackThread(context);
      const take = Math.min(Math.max(Number(limit) || 80, 1), 200);

      const messagesDesc = await prisma.tenant_feedback_message.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: "desc" },
        take,
      });
      const messages = messagesDesc.reverse();

      const unreadFromApex = await prisma.tenant_feedback_message.count({
        where: {
          threadId: thread.id,
          senderSide: "apex",
          readByTenant: false,
        },
      });

      return {
        threadId: thread.id,
        unreadFromApex,
        messages,
      };
    },

    signupPricingPreview: async (_, { businessType, modules }) => {
      const list = parseModulesJson(modules);
      const fees = await resolveSignupPricing(businessType, list);
      return {
        setupFeeETB: fees.setupFeeETB,
        quarterlyFeeETB: fees.quarterlyFeeETB,
        source: fees.source,
      };
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
        setupFeeETB,
        quarterlyFeeETB,
        paymentChannel,
        paymentTransactionRef,
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
      const now = new Date();
      const effectiveFees = await resolveSignupPricing(
        businessType || null,
        modulesJson,
      );
      const setupNum = effectiveFees.setupFeeETB;
      const quarterlyNum = effectiveFees.quarterlyFeeETB;
      const billingApplies = quarterlyFeeApplies(quarterlyNum);
      const needsPaymentApproval = billingApplies && setupNum > 0;
      if (
        needsPaymentApproval &&
        (!paymentChannel ||
          !paymentTransactionRef ||
          String(paymentTransactionRef).trim().length < 4)
      ) {
        throw new Error(
          "Setup fee payment channel and transaction reference are required",
        );
      }

      const created = await prisma.user.create({
        data: {
          UserName: userNameNorm,
          Password: hashedPassword,
          Role,
          HotelName: HotelName.trim(),
          LogoUrl,
          tinNumber: resolvedTin,
          businessType: businessType || null,
          modules: modulesJson,
          setupFeeETB: setupNum,
          quarterlyFeeETB: quarterlyNum,
          pricingRuleId: effectiveFees.pricingRuleId,
          feesManuallySet: false,
          paymentChannel: paymentChannel
            ? String(paymentChannel).trim()
            : null,
          paymentTransactionRef: paymentTransactionRef
            ? String(paymentTransactionRef).trim()
            : null,
          setupFeeApproved: !needsPaymentApproval,
          subscriptionPaymentApproved: !needsPaymentApproval,
          billingHold: false,
          isIllustrationTenant: false,
          paidQuartersCount:
            billingApplies && !needsPaymentApproval ? 1 : 0,
          billingStartedAt:
            billingApplies && !needsPaymentApproval ? now : null,
          subscriptionPaidUntil:
            billingApplies && !needsPaymentApproval
              ? computeQuarterEndFromRegistration(now, 1)
              : null,
        },
      });

      if (
        needsPaymentApproval &&
        paymentChannel &&
        paymentTransactionRef &&
        String(paymentTransactionRef).trim() !== ""
      ) {
        await createPaymentSubmission(prisma, {
          tinNumber: resolvedTin,
          paymentKind: "setup",
          amountETB: setupNum,
          paymentChannel,
          transactionRef: paymentTransactionRef,
          submittedByUserId: created.id,
          quarterNumber: null,
        });
      }

      return created;
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

      if (user.loginDisabled) {
        throw new Error(
          user.loginDisabledReason?.trim() ||
            "This account has been disabled by Apex support. Contact Apex on WhatsApp for help.",
        );
      }

      const tenantId =
        user.tinNumber != null && String(user.tinNumber).trim() !== ""
          ? String(user.tinNumber).trim()
          : String(user.HotelName).trim();

      const tenantAccount = await prisma.tenant_account.findUnique({
        where: { tinNumber: tenantId },
      });
      if (tenantAccount?.accountStatus === "banned") {
        throw new Error(
          tenantAccount.bannedReason?.trim() ||
            "This property has been banned. Contact Apex support for assistance.",
        );
      }
      if (tenantAccount?.accountStatus === "suspended") {
        throw new Error(
          tenantAccount.suspendedReason?.trim() ||
            "This property is temporarily suspended. Contact Apex support for assistance.",
        );
      }

      const subscription = await resolveTenantSubscription(prisma, user);
      if (!roleAllowedForModules(user.Role, subscription.modules)) {
        throw new Error(
          "Your account role is not included in this property's subscribed modules",
        );
      }

      const periodStatus = computeSubscriptionPeriodStatus(subscription);
      const loginAccess = resolveLoginAccess(user, subscription, periodStatus);

      if (loginAccess.accessMode === "denied") {
        throw new Error(loginAccess.message);
      }

      const token = jwt.sign(
        {
          userId: user.id,
          UserName: user.UserName,
          Role: user.Role,
          HotelName: user.HotelName,
          tinNumber: user.tinNumber,
          tenantId,
          businessType: user.businessType ?? null,
          accessMode: loginAccess.accessMode,
        },
        JWT_Secret,
        { expiresIn: JWT_EXPIRES_IN },
      );
      return {
        token,
        accessMode: loginAccess.accessMode,
        paymentKind: loginAccess.paymentKind ?? null,
        user: attachSubscriptionFields(
          {
            id: user.id,
            UserName: user.UserName,
            Role: user.Role,
            HotelName: user.HotelName,
            LogoUrl: user.LogoUrl,
            tinNumber: user.tinNumber,
            businessType: user.businessType,
          },
          subscription,
        ),
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
    ApproveTenantQuarterPayment: async (_, { tinNumber }) => {
      const tin = String(tinNumber || "").trim();
      if (!tin) throw new Error("TIN is required");

      const owner = await prisma.user.findFirst({
        where: { tinNumber: tin, Role: { in: ["Admin", "Manager"] } },
        orderBy: { id: "asc" },
      });
      if (!owner) throw new Error("Business not found for this TIN");
      if (!quarterlyFeeApplies(owner.quarterlyFeeETB ?? 0)) {
        throw new Error("This property has no quarterly billing");
      }

      const createdAt =
        resolveBillingAnchor(tenantBillingRowFromOwner(owner)) ||
        (owner.createdAt ? new Date(owner.createdAt) : new Date());
      const nextQuarters = (owner.paidQuartersCount ?? 0) + 1;
      const paidUntil = computeQuarterEndFromRegistration(
        createdAt,
        nextQuarters,
      );
      const now = new Date();

      const pending = await prisma.tenant_payment_submission.findFirst({
        where: { tinNumber: tin, paymentKind: "quarterly", status: "pending" },
        orderBy: { submittedAt: "desc" },
      });
      if (pending) {
        await prisma.tenant_payment_submission.update({
          where: { id: pending.id },
          data: { status: "approved", approvedAt: now },
        });
      }

      return await prisma.user.update({
        where: { id: owner.id },
        data: {
          subscriptionPaymentApproved: true,
          paidQuartersCount: nextQuarters,
          subscriptionPaidUntil: paidUntil,
        },
      });
    },
    ApproveTenantSetupPayment: async (_, { tinNumber }) => {
      const tin = String(tinNumber || "").trim();
      if (!tin) throw new Error("TIN is required");

      const owner = await prisma.user.findFirst({
        where: { tinNumber: tin, Role: { in: ["Admin", "Manager"] } },
        orderBy: { id: "asc" },
      });
      if (!owner) throw new Error("Business not found for this TIN");

      const now = new Date();
      const createdAt = owner.createdAt ? new Date(owner.createdAt) : now;
      const billingApplies = quarterlyFeeApplies(owner.quarterlyFeeETB ?? 0);

      const pending = await prisma.tenant_payment_submission.findFirst({
        where: { tinNumber: tin, paymentKind: "setup", status: "pending" },
        orderBy: { submittedAt: "desc" },
      });
      if (pending) {
        await prisma.tenant_payment_submission.update({
          where: { id: pending.id },
          data: { status: "approved", approvedAt: now },
        });
      }

      return await prisma.user.update({
        where: { id: owner.id },
        data: {
          setupFeeApproved: true,
          subscriptionPaymentApproved: billingApplies,
          paidQuartersCount: billingApplies ? 1 : 0,
          billingStartedAt: billingApplies ? now : null,
          subscriptionPaidUntil: billingApplies
            ? computeQuarterEndFromRegistration(createdAt, 1)
            : null,
        },
      });
    },
    ReleaseTenantBillingHold: async (_, { tinNumber }) => {
      const tin = String(tinNumber || "").trim();
      if (!tin) throw new Error("TIN is required");

      const owner = await prisma.user.findFirst({
        where: { tinNumber: tin, Role: { in: ["Admin", "Manager"] } },
        orderBy: { id: "asc" },
      });
      if (!owner) throw new Error("Business not found for this TIN");
      if (owner.isIllustrationTenant) {
        throw new Error("Illustration properties do not use billing hold");
      }
      if (!owner.billingHold) {
        throw new Error("This property is not on billing hold");
      }

      const now = new Date();
      const billingApplies = quarterlyFeeApplies(owner.quarterlyFeeETB ?? 0);
      const paidUntil = billingApplies
        ? computeQuarterEndFromRegistration(now, 1)
        : null;

      return await prisma.user.update({
        where: { id: owner.id },
        data: {
          billingHold: false,
          billingStartedAt: now,
          paidQuartersCount: billingApplies ? 1 : 0,
          subscriptionPaidUntil: paidUntil,
          subscriptionPaymentApproved:
            billingApplies && Boolean(owner.setupFeeApproved),
        },
      });
    },
    SubmitTenantPayment: async (
      _,
      { paymentKind, paymentChannel, transactionRef },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      if (!["Admin", "Manager"].includes(context.user.Role)) {
        throw new Error("Only Admin or Manager can submit payment verification");
      }

      const kind = String(paymentKind || "").trim().toLowerCase();
      if (kind !== "setup" && kind !== "quarterly") {
        throw new Error("paymentKind must be setup or quarterly");
      }
      const ref = String(transactionRef || "").trim();
      if (!ref) throw new Error("Transaction reference is required");
      const channel = String(paymentChannel || "").trim();
      if (!channel) throw new Error("Payment channel is required");

      const creator = await prisma.user.findUnique({
        where: { id: context.user.userId },
      });
      const subscription = await resolveTenantSubscription(
        prisma,
        creator || context.user,
      );
      if (subscription.isIllustrationTenant || subscription.billingHold) {
        throw new Error(
          "Payment submission is not required for this property (illustration or billing hold).",
        );
      }

      const tin = await tenantTinFromUser(creator || context.user);

      const amountETB =
        kind === "setup"
          ? Number(subscription.setupFeeETB) || 0
          : Number(subscription.quarterlyFeeETB) || 0;
      if (amountETB <= 0) {
        throw new Error("No payment amount configured for this property");
      }

      const quarterNumber =
        kind === "quarterly"
          ? (subscription.paidQuartersCount ?? 0) + 1
          : null;

      const submission = await createPaymentSubmission(prisma, {
        tinNumber: tin,
        paymentKind: kind,
        amountETB,
        paymentChannel: channel,
        transactionRef: ref,
        submittedByUserId: context.user.userId,
        quarterNumber,
      });

      await prisma.user.updateMany({
        where: { tinNumber: tin, Role: { in: ["Admin", "Manager"] } },
        data: {
          paymentChannel: channel,
          paymentTransactionRef: ref,
          ...(kind === "quarterly"
            ? { subscriptionPaymentApproved: false }
            : {}),
        },
      });

      const owner = await prisma.user.findFirst({
        where: { tinNumber: tin, Role: { in: ["Admin", "Manager"] } },
        orderBy: { id: "asc" },
      });
      if (owner && kind === "setup") {
        await prisma.user.update({
          where: { id: owner.id },
          data: { paymentChannel: channel, paymentTransactionRef: ref },
        });
      }

      return submission;
    },
    sendTenantFeedbackMessage: async (_, { body, imageUrl }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      assertAdminOrManager(context);
      const text = String(body || "").trim();
      const image = String(imageUrl || "").trim();
      if (!text && !image) {
        throw new Error("Message text or an image is required");
      }
      if (text.length > 4000) {
        throw new Error("Message is too long (max 4000 characters)");
      }
      if (image && !/^https:\/\/.+/i.test(image)) {
        throw new Error("Image URL must be a secure https link");
      }

      const thread = await getOrCreateFeedbackThread(context);
      const msg = await prisma.tenant_feedback_message.create({
        data: {
          threadId: thread.id,
          senderSide: "tenant",
          tenantUserId: context.user.userId,
          tenantUserName: context.user.UserName,
          tenantRole: context.user.Role,
          body: text,
          imageUrl: image || null,
          readByTenant: true,
          readByApex: false,
        },
      });

      await prisma.tenant_feedback_thread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date(), status: "open" },
      });

      return msg;
    },
    markTenantFeedbackRead: async (_, __, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      assertAdminOrManager(context);
      const thread = await getOrCreateFeedbackThread(context);
      await prisma.tenant_feedback_message.updateMany({
        where: {
          threadId: thread.id,
          senderSide: "apex",
          readByTenant: false,
        },
        data: { readByTenant: true },
      });
      return true;
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

      const subscription = await resolveTenantSubscription(prisma, creator || context.user);
      const periodStatus = computeSubscriptionPeriodStatus(subscription);
      if (!subscriptionAllowsFullSystemAccess(periodStatus)) {
        throw new Error(
          "Staff credentials cannot be created while subscription payment is pending or in grace renewal.",
        );
      }
      if (!roleAllowedForModules(Role, subscription.modules)) {
        throw new Error(
          `Role "${Role}" requires a module that is not subscribed for this property`,
        );
      }

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
          await Promise.all(
            orders.map(async (orderData) => {
              const serviceCaption = await serviceCaptionForTableNo(
                orderData.tableNo,
                context,
              );
              return prisma.order.create({
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
                  serviceCaption,
                },
              });
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
        const serviceCaption = await serviceCaptionForTableNo(tableNo, context);
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
            serviceCaption,
          },
        });

        return order;
      } catch (error) {
        throw error;
      }
    },
    UpdateLiveOrder: async (
      _,
      { id, tableNo, waiterName, orderAmount, title },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      if (context.user.__authExpired) {
        throw new Error("JWT expired");
      }
      const dbUser = await loadAuthUserFromDb(context, prisma);
      const authCtx = enrichContextUser(context, dbUser);
      if (!roleIsOneOf(authCtx.user, ["Cashier", "Admin", "Manager"])) {
        throw new Error("Not authorized to update live orders");
      }
      const order = await findTenantOrderById(authCtx, prisma, id);
      if (!order) {
        throw new Error("Order not found or not authorized");
      }
      if (String(order.payment || "").toLowerCase() === "paid") {
        throw new Error("Paid orders cannot be edited");
      }
      if (String(order.status || "").toLowerCase() === "cancelled") {
        throw new Error("Cancelled orders cannot be edited");
      }
      if (String(order.status || "").toLowerCase() === "completed") {
        throw new Error("Completed orders cannot be edited");
      }
      if (!isSameCafeBusinessDay(order.createdAt)) {
        throw new Error("Only today's unpaid orders can be edited");
      }
      const data = {};
      if (tableNo != null) {
        data.tableNo = tableNo;
        data.serviceCaption = await serviceCaptionForTableNo(tableNo, context);
      }
      if (waiterName != null) data.waiterName = waiterName;
      if (orderAmount != null) {
        const nextAmount = Math.floor(Number(orderAmount));
        if (nextAmount !== Math.floor(Number(order.orderAmount))) {
          data.orderAmount = nextAmount;
          // Re-queue same ticket at kitchen/bar with the new total quantity.
          data.status = "Pending";
        }
      }
      if (title != null) data.title = title;
      return await prisma.order.update({
        where: { id },
        data,
      });
    },
    UpdatePayment: async (_, { id, payment, withBank }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const dbUser = await loadAuthUserFromDb(context, prisma);
      const authCtx = enrichContextUser(context, dbUser);
      if (!roleIsOneOf(authCtx.user, ["Cashier", "Admin", "Manager", "HotelCashier"])) {
        throw new Error("Not authorized");
      }
      const order = await findTenantOrderById(authCtx, prisma, id);
      if (!order) {
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
        const dbUser = await loadAuthUserFromDb(context, prisma);
        const authCtx = enrichContextUser(context, dbUser);
        if (!roleIsOneOf(authCtx.user, ["Cashier", "Admin", "Manager"])) {
          throw new Error("Not authorized");
        }
        const order = await findTenantOrderById(authCtx, prisma, id);

        if (!order) {
          throw new Error("Order not found or not authorized");
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

      const next = Number(amount);
      if (!Number.isFinite(next) || next < 0) {
        throw new Error("Remaining credit cannot be negative");
      }

      return await prisma.creditRegistration.update({
        where: { id: id },
        data: {
          amount: next,
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
      if (context.user.__authExpired) {
        throw new Error("JWT expired");
      }
      const dbUser = await loadAuthUserFromDb(context, prisma);
      const authCtx = enrichContextUser(context, dbUser);
      const order = await findTenantOrderById(authCtx, prisma, id);
      if (!order) {
        throw new Error("Order not found or not authorized");
      }
      const next = status != null ? String(status).trim() : "";
      const nextLower = next.toLowerCase();
      if (nextLower === "cancelled") {
        if (!canCancelLiveOrder(authCtx.user, order)) {
          throw new Error("Not authorized to remove this order");
        }
        if (String(order.payment || "").toLowerCase() === "paid") {
          throw new Error("Paid orders cannot be removed");
        }
        if (String(order.status || "").toLowerCase() === "cancelled") {
          throw new Error("Order is already removed");
        }
        if (!isSameCafeBusinessDay(order.createdAt)) {
          throw new Error("Only today's unpaid orders can be removed");
        }
      } else if (nextLower === "completed") {
        if (!canCompleteLiveOrder(authCtx.user, order)) {
          throw new Error("Not authorized to complete this order");
        }
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
    CreateTable: async (_, { tableNo, capacity, orderCaption }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const caption =
        orderCaption != null ? String(orderCaption).trim() : "";
      return await prisma.table.create({
        data: {
          tableNo,
          HotelName: tenantScopeFromContext(context),
          capacity,
          orderCaption: caption || null,
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
    UpdateTable: async (_, { id, tableNo, capacity, orderCaption }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      const table = await prisma.table.findUnique({
        where: { id: id },
      });
      if (!table || !tenantHotelReadMatches(context, table.HotelName)) {
        throw new Error("Table not found or not authorized");
      }
      const data = { tableNo, capacity };
      if (orderCaption !== undefined) {
        const caption = String(orderCaption ?? "").trim();
        data.orderCaption = caption || null;
      }
      return await prisma.table.update({
        where: { id: id },
        data,
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
        registrantType,
        companyTinNumber,
        affiliatedCompany,
      },
      context,
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      const tenant = tenantScopeFromContext(context);
      const requested = Number(amount);
      const paid = Number(paidAmount) || 0;
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new Error("Requested credit must be greater than zero");
      }
      if (paid < 0 || paid > requested + 1e-6) {
        throw new Error("Presale paid cannot exceed requested credit");
      }
      const tierRow = await prisma.creditLevel.findFirst({
        where: { HotelName: tenant, level: String(creditLevel).trim() },
      });
      if (tierRow && requested > Number(tierRow.requiredAmount) + 1e-6) {
        throw new Error(
          `Requested credit cannot exceed ${creditLevel} tier maximum of ETB ${tierRow.requiredAmount}`,
        );
      }
      const role = String(context.user.Role || "");
      const type = String(registrantType || "STAFF").trim().toUpperCase();
      const approvalStatus = role === "Admin" ? "AUTHORIZED" : "PENDING_ADMIN";
      const adminActorName =
        role === "Admin" ? String(context.user.userName || "").trim() : null;
      const adminAuthorizedAt = role === "Admin" ? new Date() : null;
      return await prisma.creditRegistration.create({
        data: {
          name,
          imageUrl,
          sex,
          creditLevel,
          phoneNumber,
          amount: requested,
          timeInterval,
          timeFrame,
          paidAmount: paid,
          registrationDate,
          HotelName: tenant,
          registrantType: type === "COMPANY" ? "COMPANY" : "STAFF",
          approvalStatus,
          companyTinNumber: String(companyTinNumber || "").trim(),
          affiliatedCompany: String(affiliatedCompany || "").trim(),
          adminActorName: adminActorName || undefined,
          adminAuthorizedAt: adminAuthorizedAt || undefined,
        },
      });
    },
    AuthorizeCreditRegistration: async (_, { id }, context) => {
      assertRole(context, ["Admin"]);
      const creditReg = await prisma.creditRegistration.findUnique({
        where: { id },
      });
      if (
        !creditReg ||
        !tenantHotelReadMatches(context, creditReg.HotelName)
      ) {
        throw new Error("Credit registration not found");
      }
      return await prisma.creditRegistration.update({
        where: { id },
        data: {
          approvalStatus: "AUTHORIZED",
          rejectionReason: null,
          adminActorName: String(context.user.userName || "").trim() || null,
          adminAuthorizedAt: new Date(),
        },
      });
    },
    RejectCreditRegistration: async (_, { id, reason }, context) => {
      assertRole(context, ["Admin"]);
      const creditReg = await prisma.creditRegistration.findUnique({
        where: { id },
      });
      if (
        !creditReg ||
        !tenantHotelReadMatches(context, creditReg.HotelName)
      ) {
        throw new Error("Credit registration not found");
      }
      return await prisma.creditRegistration.update({
        where: { id },
        data: {
          approvalStatus: "REJECTED",
          rejectionReason: String(reason || "").trim() || "Rejected by admin",
          adminActorName: String(context.user.userName || "").trim() || null,
          adminAuthorizedAt: new Date(),
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
        supplierName,
        supplierPhone,
        Address,
        purchaseWithVat,
        supplierTinNumber,
        paidAmount,
        purchaseRequestId,
        voucherNumber: sharedVoucherNumber,
      },
      context
    ) => {
      assertRole(context, ["Store"]);
      const tenant = tenantScopeFromContext(context);
      if (purchaseRequestId != null) {
        const pr = await prisma.purchaseRequest.findUnique({
          where: { id: purchaseRequestId },
        });
        if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
          throw new Error("Purchase request not found");
        }
        if (!isPurchaseRequestAuthorized(pr.status)) {
          throw new Error(
            "Purchase request must be authorized by manager before receiving stock",
          );
        }
      }
      const shared = Math.floor(Number(sharedVoucherNumber) || 0);
      const voucherNumber =
        shared > 0
          ? shared
          : (
              await allocateVoucherNumber(
                prisma,
                tenant,
                VOUCHER_TYPES.ITEM_REGISTRATION,
                tenantHotelKeysFromContext(context),
              )
            ).voucherNumber;
      const row = await prisma.itemRegistration.create({
        data: {
          name,
          imageUrl,
          category,
          amount,
          measuredBy,
          unitPrice,
          registrationDate,
          expireDate,
          supplierName,
          supplierPhone,
          Address,
          purchaseWithVat: isVatEnabled(purchaseWithVat),
          supplierTinNumber: String(supplierTinNumber ?? "").trim(),
          paidAmount,
          HotelName: tenant,
          voucherNumber,
          purchaseRequestId: purchaseRequestId ?? null,
          approvalStatus: isLodgingBusiness(context) ? PENDING_STORE : "AUTHORIZED",
          statusBy: isLodgingBusiness(context)
            ? String(context.user.UserName ?? "").trim()
            : undefined,
        },
      });
      return withVoucherDisplay(row);
    },

    createItemRegistrationsBatch: async (_, { lines }, context) => {
      assertRole(context, ["Store"]);
      const items = Array.isArray(lines) ? lines : [];
      if (!items.length) throw new Error("At least one registration line is required");
      const { tenant, voucherNumber } = await allocateSharedVoucherForTenant(
        prisma,
        context,
        VOUCHER_TYPES.ITEM_REGISTRATION,
      );
      const approvalStatus = isLodgingBusiness(context)
        ? PENDING_STORE
        : "AUTHORIZED";
      for (const line of items) {
        if (line.purchaseRequestId != null) {
          const pr = await prisma.purchaseRequest.findUnique({
            where: { id: line.purchaseRequestId },
          });
          if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
            throw new Error("Purchase request not found");
          }
          if (!isPurchaseRequestAuthorized(pr.status)) {
            throw new Error(
              "Purchase request must be authorized by manager before receiving stock",
            );
          }
        }
      }
      const rows = await prisma.$transaction(
        items.map((line) =>
          prisma.itemRegistration.create({
            data: {
              name: line.name,
              imageUrl: line.imageUrl,
              category: line.category,
              amount: line.amount,
              measuredBy: line.measuredBy,
              unitPrice: line.unitPrice,
              registrationDate: line.registrationDate,
              expireDate: line.expireDate,
              supplierName: line.supplierName,
              supplierPhone: line.supplierPhone,
              Address: line.Address,
              purchaseWithVat: isVatEnabled(line.purchaseWithVat),
              supplierTinNumber: String(line.supplierTinNumber ?? "").trim(),
              paidAmount: line.paidAmount,
              HotelName: tenant,
              voucherNumber,
              purchaseRequestId: line.purchaseRequestId ?? null,
              approvalStatus,
              statusBy:
                approvalStatus === PENDING_STORE
                  ? String(context.user.UserName ?? "").trim()
                  : undefined,
            },
          }),
        ),
      );
      return rows.map(withVoucherDisplay);
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
      if (
        context.user.Role === "Store" &&
        itemRegistration.approvalStatus !== PENDING_STORE
      ) {
        throw new Error(
          "Only registrations awaiting your review can be deleted",
        );
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
        supplierName,
        supplierPhone,
        Address,
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
      if (
        context.user.Role === "Store" &&
        itemReg.approvalStatus !== PENDING_STORE
      ) {
        throw new Error(
          "Only registrations awaiting your review can be edited",
        );
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
          supplierName,
          supplierPhone,
          Address,
          purchaseWithVat: isVatEnabled(purchaseWithVat),
          supplierTinNumber: String(supplierTinNumber ?? "").trim(),
          paidAmount
        },
      });
    },

    submitItemRegistrationsToCostControl: async (_, { ids }, context) => {
      assertStoreUser(context);
      const uniqueIds = [...new Set((ids || []).map((x) => Math.floor(Number(x))).filter((x) => x > 0))];
      if (!uniqueIds.length) throw new Error("Select at least one line");
      const rows = await prisma.itemRegistration.findMany({
        where: { id: { in: uniqueIds } },
      });
      if (rows.length !== uniqueIds.length) {
        throw new Error("One or more registrations were not found");
      }
      const updated = [];
      for (const item of rows) {
        if (!tenantHotelReadMatches(context, item.HotelName)) {
          throw new Error("Registration not found");
        }
        assertRegistrationPendingStore(item);
        const row = await prisma.itemRegistration.update({
          where: { id: item.id },
          data: { approvalStatus: "PENDING_CC" },
        });
        updated.push(withVoucherDisplay(row));
      }
      return updated;
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
      const { voucherNumber } = await allocateVoucherNumber(
        prisma,
        tenant,
        VOUCHER_TYPES.PURCHASE_REQUEST,
        tenantHotelKeysFromContext(context),
      );
      const row = await prisma.purchaseRequest.create({
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
          status: PENDING_STORE,
          storeUserName: context.user.UserName,
          voucherNumber,
        },
      });
      return withVoucherDisplay(row);
    },

    createPurchaseRequestsBatch: async (_, { lines }, context) => {
      assertRole(context, ["Store"]);
      const items = Array.isArray(lines) ? lines : [];
      if (!items.length) throw new Error("At least one purchase line is required");
      const { tenant, voucherNumber } = await allocateSharedVoucherForTenant(
        prisma,
        context,
        VOUCHER_TYPES.PURCHASE_REQUEST,
      );
      const rows = await prisma.$transaction(
        items.map((line) =>
          prisma.purchaseRequest.create({
            data: {
              HotelName: tenant,
              itemName: String(line.itemName).trim(),
              quantity: line.quantity,
              measuredBy: line.measuredBy,
              notes: line.notes ?? "",
              estimatedUnitPrice: line.estimatedUnitPrice ?? 0,
              supplierName: line.supplierName ?? "",
              supplierPhone: line.supplierPhone ?? "",
              category: line.category ?? "Others",
              status: PENDING_STORE,
              storeUserName: context.user.UserName,
              voucherNumber,
            },
          }),
        ),
      );
      return rows.map(withVoucherDisplay);
    },

    updatePurchaseRequestStoreDraft: async (
      _,
      {
        id,
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
      assertStoreUser(context);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      assertPurchasePendingStore(pr);
      const data = {};
      if (itemName != null) data.itemName = String(itemName).trim();
      if (quantity != null) data.quantity = quantity;
      if (measuredBy != null) data.measuredBy = measuredBy;
      if (notes != null) data.notes = notes;
      if (estimatedUnitPrice != null) data.estimatedUnitPrice = estimatedUnitPrice;
      if (supplierName != null) data.supplierName = supplierName;
      if (supplierPhone != null) data.supplierPhone = supplierPhone;
      if (category != null) data.category = category;
      const row = await prisma.purchaseRequest.update({ where: { id }, data });
      return withVoucherDisplay(row);
    },

    deletePurchaseRequestStoreDraft: async (_, { id }, context) => {
      assertStoreUser(context);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      assertPurchasePendingStore(pr);
      await prisma.purchaseRequest.delete({ where: { id } });
      return true;
    },

    submitPurchaseRequestsToCostControl: async (_, { ids }, context) => {
      assertStoreUser(context);
      const uniqueIds = [...new Set((ids || []).map((x) => Math.floor(Number(x))).filter((x) => x > 0))];
      if (!uniqueIds.length) throw new Error("Select at least one line");
      const rows = await prisma.purchaseRequest.findMany({
        where: { id: { in: uniqueIds } },
      });
      if (rows.length !== uniqueIds.length) {
        throw new Error("One or more purchase requests were not found");
      }
      const updated = [];
      for (const pr of rows) {
        if (!tenantHotelReadMatches(context, pr.HotelName)) {
          throw new Error("Purchase request not found");
        }
        assertPurchasePendingStore(pr);
        const row = await prisma.purchaseRequest.update({
          where: { id: pr.id },
          data: { status: "PENDING_CC" },
        });
        updated.push(withVoucherDisplay(row));
      }
      return updated;
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
        throw new Error("Request is not awaiting cost control check");
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
      const row = await prisma.purchaseRequest.update({
        where: { id },
        data: {
          status: "PENDING_FINANCE",
          ccProfileId: prof.id,
          ccActorName: prof.displayName,
          ccApprovedAt: new Date(),
          rejectionReason: null,
        },
      });
      return withVoucherDisplay(row);
    },

    approvePurchaseRequestsCCBatch: async (
      _,
      { ids, costControllerProfileId },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const unique = uniquePositiveIds(ids);
      if (!unique.length) return [];
      const rows = await prisma.purchaseRequest.findMany({
        where: { id: { in: unique } },
      });
      if (!rows.length) throw new Error("Purchase request not found");
      const hotel = rows[0].HotelName;
      if (!rows.every((r) => tenantHotelReadMatches(context, r.HotelName))) {
        throw new Error("Purchase request not found");
      }
      if (!rows.every((r) => r.HotelName === hotel)) {
        throw new Error("All requests must belong to the same property");
      }
      if (!rows.every((r) => r.status === "PENDING_CC")) {
        throw new Error("One or more requests are not awaiting cost control check");
      }
      const prof = await prisma.costControllerProfile.findFirst({
        where: { id: costControllerProfileId, HotelName: hotel },
      });
      if (!prof) {
        throw new Error("Select a registered cost controller identity");
      }
      const now = new Date();
      const updated = await prisma.$transaction(
        unique.map((id) =>
          prisma.purchaseRequest.update({
            where: { id },
            data: {
              status: "PENDING_FINANCE",
              ccProfileId: prof.id,
              ccActorName: prof.displayName,
              ccApprovedAt: now,
              rejectionReason: null,
            },
          }),
        ),
      );
      return updated.map(withVoucherDisplay);
    },

    rejectPurchaseRequestCC: async (_, { id, reason }, context) => {
      assertRole(context, ["CostControl"]);
      const rejectionReason = requireRejectionReason(reason);
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
          rejectionReason,
        },
      });
    },

    rejectPurchaseRequestsCCBatch: async (_, { ids, reason }, context) => {
      assertRole(context, ["CostControl"]);
      const rejectionReason = requireRejectionReason(reason);
      const unique = uniquePositiveIds(ids);
      if (!unique.length) return [];
      const rows = await prisma.purchaseRequest.findMany({
        where: { id: { in: unique } },
      });
      if (!rows.length) throw new Error("Purchase request not found");
      if (!rows.every((r) => tenantHotelReadMatches(context, r.HotelName))) {
        throw new Error("Purchase request not found");
      }
      if (!rows.every((r) => r.status === "PENDING_CC")) {
        throw new Error("One or more requests are not awaiting cost control approval");
      }
      const updated = await prisma.$transaction(
        unique.map((id) =>
          prisma.purchaseRequest.update({
            where: { id },
            data: {
              status: "REJECTED_CC",
              rejectionReason,
            },
          }),
        ),
      );
      return updated.map(withVoucherDisplay);
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
      const row = await prisma.purchaseRequest.update({
        where: { id },
        data: {
          status: "PENDING_MANAGER",
          financeApprovedAt: new Date(),
          financeActorName: context.user.UserName,
          rejectionReason: null,
        },
      });
      return withVoucherDisplay(row);
    },

    approvePurchaseRequestsFinanceBatch: async (_, { ids }, context) => {
      assertRole(context, ["Finance"]);
      const unique = uniquePositiveIds(ids);
      if (!unique.length) return [];
      const rows = await prisma.purchaseRequest.findMany({
        where: { id: { in: unique } },
      });
      if (!rows.length) throw new Error("Purchase request not found");
      if (!rows.every((r) => tenantHotelReadMatches(context, r.HotelName))) {
        throw new Error("Purchase request not found");
      }
      if (!rows.every((r) => r.status === "PENDING_FINANCE")) {
        throw new Error("One or more requests are not awaiting finance approval");
      }
      const now = new Date();
      const actor = context.user.UserName;
      const updated = await prisma.$transaction(
        unique.map((id) =>
          prisma.purchaseRequest.update({
            where: { id },
            data: {
              status: "PENDING_MANAGER",
              financeApprovedAt: now,
              financeActorName: actor,
              rejectionReason: null,
            },
          }),
        ),
      );
      return updated.map(withVoucherDisplay);
    },

    authorizePurchaseRequestManager: async (_, { id }, context) => {
      assertRole(context, ["Manager"]);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      if (pr.status !== "PENDING_MANAGER") {
        throw new Error("Request is not awaiting manager authorization");
      }
      const row = await prisma.purchaseRequest.update({
        where: { id },
        data: {
          status: "AUTHORIZED",
          managerAuthorizedAt: new Date(),
          managerActorName: context.user.UserName,
          rejectionReason: null,
        },
      });
      return withVoucherDisplay(row);
    },

    rejectPurchaseRequestFinance: async (_, { id, reason }, context) => {
      assertRole(context, ["Finance"]);
      const rejectionReason = requireRejectionReason(reason);
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
          rejectionReason,
        },
      });
    },

    rejectPurchaseRequestsFinanceBatch: async (_, { ids, reason }, context) => {
      assertRole(context, ["Finance"]);
      const rejectionReason = requireRejectionReason(reason);
      const unique = uniquePositiveIds(ids);
      if (!unique.length) return [];
      const rows = await prisma.purchaseRequest.findMany({
        where: { id: { in: unique } },
      });
      if (!rows.length) throw new Error("Purchase request not found");
      if (!rows.every((r) => tenantHotelReadMatches(context, r.HotelName))) {
        throw new Error("Purchase request not found");
      }
      if (!rows.every((r) => r.status === "PENDING_FINANCE")) {
        throw new Error("Request is not awaiting finance approval");
      }
      const updated = await prisma.$transaction(
        unique.map((id) =>
          prisma.purchaseRequest.update({
            where: { id },
            data: {
              status: "REJECTED_FINANCE",
              rejectionReason,
            },
          }),
        ),
      );
      return updated.map(withVoucherDisplay);
    },

    rejectPurchaseRequestManager: async (_, { id, reason }, context) => {
      assertRole(context, ["Manager"]);
      const rejectionReason = requireRejectionReason(reason);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      if (pr.status !== "PENDING_MANAGER") {
        throw new Error("Request is not awaiting manager authorization");
      }
      const row = await prisma.purchaseRequest.update({
        where: { id },
        data: {
          status: "REJECTED_MANAGER",
          rejectionReason,
        },
      });
      return withVoucherDisplay(row);
    },

    submitPurchaseRequestUnitPriceChange: async (
      _,
      { id, proposedUnitPrice },
      context,
    ) => {
      assertRole(context, ["Store"]);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      if (!isPurchaseRequestAuthorized(pr.status)) {
        throw new Error("Only authorized purchase requests can revise unit price");
      }
      const price = Number(proposedUnitPrice);
      if (!(price >= 0)) throw new Error("Invalid unit price");
      const row = await prisma.purchaseRequest.update({
        where: { id },
        data: {
          pendingUnitPrice: price,
          unitPriceChangeStatus: "PENDING_CC",
        },
      });
      return withVoucherDisplay(row);
    },

    checkPurchaseRequestUnitPriceCC: async (
      _,
      { id, costControllerProfileId },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      if (pr.unitPriceChangeStatus !== "PENDING_CC") {
        throw new Error("No unit price change awaiting cost control");
      }
      const prof = await prisma.costControllerProfile.findFirst({
        where: { id: costControllerProfileId, HotelName: pr.HotelName },
      });
      if (!prof) throw new Error("Select a registered cost controller identity");
      const row = await prisma.purchaseRequest.update({
        where: { id },
        data: { unitPriceChangeStatus: "PENDING_FINANCE" },
      });
      return withVoucherDisplay(row);
    },

    approvePurchaseRequestUnitPriceFinance: async (_, { id }, context) => {
      assertRole(context, ["Finance"]);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      if (pr.unitPriceChangeStatus !== "PENDING_FINANCE") {
        throw new Error("No unit price change awaiting finance");
      }
      const row = await prisma.purchaseRequest.update({
        where: { id },
        data: { unitPriceChangeStatus: "PENDING_MANAGER" },
      });
      return withVoucherDisplay(row);
    },

    authorizePurchaseRequestUnitPriceManager: async (_, { id }, context) => {
      assertRole(context, ["Manager"]);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      if (pr.unitPriceChangeStatus !== "PENDING_MANAGER") {
        throw new Error("No unit price change awaiting manager");
      }
      const price = Number(pr.pendingUnitPrice);
      const row = await prisma.purchaseRequest.update({
        where: { id },
        data: {
          estimatedUnitPrice: price,
          pendingUnitPrice: null,
          unitPriceChangeStatus: "AUTHORIZED",
        },
      });
      return withVoucherDisplay(row);
    },

    rejectPurchaseRequestUnitPrice: async (_, { id, reason }, context) => {
      const role = context.user?.Role;
      if (!["CostControl", "Finance", "Manager"].includes(role)) {
        throw new Error("Not authorized");
      }
      const rejectionReason = requireRejectionReason(reason);
      const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
      if (!pr || !tenantHotelReadMatches(context, pr.HotelName)) {
        throw new Error("Purchase request not found");
      }
      const row = await prisma.purchaseRequest.update({
        where: { id },
        data: {
          pendingUnitPrice: null,
          unitPriceChangeStatus: "REJECTED",
          rejectionReason,
        },
      });
      return withVoucherDisplay(row);
    },

    submitItemRegistrationUnitPriceChange: async (
      _,
      { id, proposedUnitPrice },
      context,
    ) => {
      assertRole(context, ["Store"]);
      const item = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
        throw new Error("Inventory item not found");
      }
      if (!isItemRegistrationActive(item.approvalStatus)) {
        throw new Error(
          "Only authorized inventory items can revise unit price",
        );
      }
      const price = Number(proposedUnitPrice);
      if (!(price >= 0)) throw new Error("Invalid unit price");
      const row = await prisma.itemRegistration.update({
        where: { id },
        data: {
          pendingUnitPrice: price,
          unitPriceChangeStatus: "PENDING_CC",
        },
      });
      return withVoucherDisplay(row);
    },

    checkItemRegistrationUnitPriceCC: async (
      _,
      { id, costControllerProfileId },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const item = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
        throw new Error("Inventory item not found");
      }
      if (item.unitPriceChangeStatus !== "PENDING_CC") {
        throw new Error("No unit price change awaiting cost control");
      }
      const prof = await prisma.costControllerProfile.findFirst({
        where: { id: costControllerProfileId, HotelName: item.HotelName },
      });
      if (!prof) throw new Error("Select a registered cost controller identity");
      const row = await prisma.itemRegistration.update({
        where: { id },
        data: { unitPriceChangeStatus: "PENDING_FINANCE" },
      });
      return withVoucherDisplay(row);
    },

    approveItemRegistrationUnitPriceFinance: async (_, { id }, context) => {
      assertRole(context, ["Finance"]);
      const item = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
        throw new Error("Inventory item not found");
      }
      if (item.unitPriceChangeStatus !== "PENDING_FINANCE") {
        throw new Error("No unit price change awaiting finance");
      }
      const row = await prisma.itemRegistration.update({
        where: { id },
        data: { unitPriceChangeStatus: "PENDING_MANAGER" },
      });
      return withVoucherDisplay(row);
    },

    authorizeItemRegistrationUnitPriceManager: async (_, { id }, context) => {
      assertRole(context, ["Manager"]);
      const item = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
        throw new Error("Inventory item not found");
      }
      if (item.unitPriceChangeStatus !== "PENDING_MANAGER") {
        throw new Error("No unit price change awaiting manager");
      }
      const price = Number(item.pendingUnitPrice);
      const row = await prisma.itemRegistration.update({
        where: { id },
        data: {
          unitPrice: price,
          pendingUnitPrice: null,
          unitPriceChangeStatus: "AUTHORIZED",
        },
      });
      return withVoucherDisplay(row);
    },

    rejectItemRegistrationUnitPrice: async (_, { id, reason }, context) => {
      const role = context.user?.Role;
      if (!["CostControl", "Finance", "Manager"].includes(role)) {
        throw new Error("Not authorized");
      }
      const rejectionReason = requireRejectionReason(reason);
      const item = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
        throw new Error("Inventory item not found");
      }
      const row = await prisma.itemRegistration.update({
        where: { id },
        data: {
          pendingUnitPrice: null,
          unitPriceChangeStatus: "REJECTED",
          rejectionReason,
        },
      });
      return withVoucherDisplay(row);
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
      const { voucherNumber } = await allocateVoucherNumber(
        prisma,
        tenant,
        VOUCHER_TYPES.STOCK_MOVEMENT,
        tenantHotelKeysFromContext(context),
      );
      const row = await prisma.stockOutRequest.create({
        data: {
          HotelName: tenant,
          itemRegistrationId,
          itemNameSnapshot: String(item.name ?? "").trim(),
          movementType: String(movementType),
          amount: amt,
          stakeHolderOrReason: stakeText,
          status: PENDING_STORE,
          voucherNumber,
          requestedByUserName: context.user.UserName,
        },
      });
      return withVoucherDisplay(row);
    },

    createStockOutRequestsBatch: async (_, { lines }, context) => {
      assertRole(context, ["Store"]);
      const items = Array.isArray(lines) ? lines : [];
      if (!items.length) throw new Error("At least one movement line is required");
      const itemIds = [
        ...new Set(
          items.map((l) => Math.floor(Number(l.itemRegistrationId))).filter((id) => id > 0),
        ),
      ];
      const stockItems = await prisma.itemRegistration.findMany({
        where: { id: { in: itemIds } },
      });
      const itemById = new Map(stockItems.map((i) => [i.id, i]));
      const tenant = tenantScopeFromContext(context);
      for (const line of items) {
        const item = itemById.get(line.itemRegistrationId);
        if (!item || !tenantHotelReadMatches(context, item.HotelName)) {
          throw new Error("Item not found");
        }
        const amt = Number(line.amount);
        if (!(amt > 0)) throw new Error("Amount must be positive");
        const stakeText = String(line.stakeHolderOrReason ?? "").trim();
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
      }
      const { voucherNumber } = await allocateSharedVoucherForTenant(
        prisma,
        context,
        VOUCHER_TYPES.STOCK_MOVEMENT,
      );
      const rows = await prisma.$transaction(
        items.map((line) => {
          const item = itemById.get(line.itemRegistrationId);
          return prisma.stockOutRequest.create({
            data: {
              HotelName: tenant,
              itemRegistrationId: line.itemRegistrationId,
              itemNameSnapshot: String(item?.name ?? "").trim(),
              movementType: String(line.movementType),
              amount: Number(line.amount),
              stakeHolderOrReason: String(line.stakeHolderOrReason ?? "").trim(),
              status: PENDING_STORE,
              voucherNumber,
              requestedByUserName: context.user.UserName,
            },
          });
        }),
      );
      return rows.map(withVoucherDisplay);
    },

    updateStockOutRequestStoreDraft: async (
      _,
      { id, movementType, amount, stakeHolderOrReason },
      context,
    ) => {
      assertStoreUser(context);
      const reqRow = await prisma.stockOutRequest.findUnique({ where: { id } });
      if (!reqRow || !tenantHotelReadMatches(context, reqRow.HotelName)) {
        throw new Error("Request not found");
      }
      assertStockPendingStore(reqRow);
      const item = await prisma.itemRegistration.findUnique({
        where: { id: reqRow.itemRegistrationId },
      });
      if (!item) throw new Error("Item not found");
      const data = {};
      if (movementType != null) {
        data.movementType = String(movementType);
      }
      if (stakeHolderOrReason != null) {
        const stakeText = String(stakeHolderOrReason).trim();
        const stakeKey = normalizeKitchenBarStation(stakeText);
        if (stakeKey === "MANAGEMENT") {
          throw new Error(
            "Management stock issue must be recorded from station daily count.",
          );
        }
        data.stakeHolderOrReason = stakeText;
      }
      if (amount != null) {
        const amt = Number(amount);
        if (!(amt > 0)) throw new Error("Amount must be positive");
        const otherPending = await prisma.stockOutRequest.aggregate({
          where: {
            itemRegistrationId: reqRow.itemRegistrationId,
            status: PENDING_STORE,
            id: { not: id },
          },
          _sum: { amount: true },
        });
        const reserved =
          Number(otherPending._sum.amount || 0) + amt;
        if (item.amount - reserved < 1) {
          throw new Error(
            "At least 1 unit must remain in stock for every item.",
          );
        }
        data.amount = amt;
      }
      const row = await prisma.stockOutRequest.update({ where: { id }, data });
      return withVoucherDisplay({
        ...row,
        status: normalizeStockOutStatus(row.status),
      });
    },

    deleteStockOutRequestStoreDraft: async (_, { id }, context) => {
      assertStoreUser(context);
      const reqRow = await prisma.stockOutRequest.findUnique({ where: { id } });
      if (!reqRow || !tenantHotelReadMatches(context, reqRow.HotelName)) {
        throw new Error("Request not found");
      }
      assertStockPendingStore(reqRow);
      await prisma.stockOutRequest.delete({ where: { id } });
      return true;
    },

    submitStockOutRequestsToCostControl: async (_, { ids }, context) => {
      assertStoreUser(context);
      const uniqueIds = [...new Set((ids || []).map((x) => Math.floor(Number(x))).filter((x) => x > 0))];
      if (!uniqueIds.length) throw new Error("Select at least one line");
      const rows = await prisma.stockOutRequest.findMany({
        where: { id: { in: uniqueIds } },
      });
      if (rows.length !== uniqueIds.length) {
        throw new Error("One or more movement requests were not found");
      }
      const updated = [];
      for (const reqRow of rows) {
        if (!tenantHotelReadMatches(context, reqRow.HotelName)) {
          throw new Error("Request not found");
        }
        assertStockPendingStore(reqRow);
        const row = await prisma.stockOutRequest.update({
          where: { id: reqRow.id },
          data: { status: "PENDING_CC" },
        });
        updated.push(
          withVoucherDisplay({
            ...row,
            status: normalizeStockOutStatus(row.status),
          }),
        );
      }
      return updated;
    },

    checkStockOutRequestCC: async (
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
      if (!isStockOutPendingCC(reqRow.status)) {
        throw new Error("Request is not awaiting cost control check");
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
      const row = await prisma.stockOutRequest.update({
        where: { id },
        data: {
          status: "PENDING_FINANCE",
          ccProfileId: prof.id,
          ccActorName: prof.displayName,
          ccCheckedAt: new Date(),
          rejectionReason: null,
        },
      });
      return withVoucherDisplay(row);
    },

    approveStockOutRequestsBatch: async (
      _,
      { ids, costControllerProfileId },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const unique = uniquePositiveIds(ids);
      if (!unique.length) return [];
      const rows = await prisma.stockOutRequest.findMany({
        where: { id: { in: unique } },
      });
      if (!rows.length) throw new Error("Request not found");
      const hotel = rows[0].HotelName;
      if (!rows.every((r) => tenantHotelReadMatches(context, r.HotelName))) {
        throw new Error("Request not found");
      }
      if (!rows.every((r) => r.HotelName === hotel)) {
        throw new Error("All requests must belong to the same property");
      }
      if (!rows.every((r) => isStockOutPendingCC(r.status))) {
        throw new Error("One or more requests are not awaiting cost control check");
      }
      const prof = await prisma.costControllerProfile.findFirst({
        where: { id: costControllerProfileId, HotelName: hotel },
      });
      if (!prof) {
        throw new Error("Select a registered cost controller identity");
      }
      const now = new Date();
      const updated = await prisma.$transaction(
        unique.map((id) =>
          prisma.stockOutRequest.update({
            where: { id },
            data: {
              status: "PENDING_FINANCE",
              ccProfileId: prof.id,
              ccActorName: prof.displayName,
              ccCheckedAt: now,
              rejectionReason: null,
            },
          }),
        ),
      );
      return updated.map(withVoucherDisplay);
    },

    approveStockOutRequestFinance: async (_, { id }, context) => {
      assertRole(context, ["Finance"]);
      const reqRow = await prisma.stockOutRequest.findUnique({
        where: { id },
      });
      if (!reqRow || !tenantHotelReadMatches(context, reqRow.HotelName)) {
        throw new Error("Request not found");
      }
      if (!isStockOutPendingFinance(reqRow.status)) {
        throw new Error("Request is not awaiting finance approval");
      }
      const row = await prisma.stockOutRequest.update({
        where: { id },
        data: {
          status: "PENDING_MANAGER",
          financeApprovedAt: new Date(),
          financeActorName: context.user.UserName,
          rejectionReason: null,
        },
      });
      return withVoucherDisplay(row);
    },

    authorizeStockOutRequestManager: async (_, { id }, context) => {
      assertRole(context, ["Manager"]);
      const reqRow = await prisma.stockOutRequest.findUnique({
        where: { id },
      });
      if (!reqRow || !tenantHotelReadMatches(context, reqRow.HotelName)) {
        throw new Error("Request not found");
      }
      if (!isStockOutPendingManager(reqRow.status)) {
        throw new Error("Request is not awaiting manager authorization");
      }
      const actor =
        String(reqRow.managerActorName || "").trim() ||
        context.user.UserName;
      const decidedNow = new Date();
      await prisma.$transaction(async (tx) => {
        await applyStockOutToInventory(
          tx,
          reqRow,
          String(reqRow.ccActorName || actor).trim() || actor,
        );
        await tx.stockOutRequest.update({
          where: { id },
          data: {
            status: "APPROVED",
            managerAuthorizedAt: decidedNow,
            managerActorName: context.user.UserName,
            decidedAt: decidedNow,
            rejectionReason: null,
          },
        });
      });
      const row = await prisma.stockOutRequest.findUnique({ where: { id } });
      return withVoucherDisplay(row);
    },

    approveStockOutRequest: async (
      _,
      { id, costControllerProfileId },
      context,
    ) => {
      return resolvers.Mutation.checkStockOutRequestCC(
        _,
        { id, costControllerProfileId },
        context,
      );
    },

    rejectStockOutRequest: async (_, { id, reason }, context) => {
      const role = context.user?.Role;
      if (!["CostControl", "Finance", "Manager"].includes(role)) {
        throw new Error("Not authorized");
      }
      const rejectionReason = requireRejectionReason(reason);
      const reqRow = await prisma.stockOutRequest.findUnique({
        where: { id },
      });
      if (!reqRow || !tenantHotelReadMatches(context, reqRow.HotelName)) {
        throw new Error("Request not found");
      }
      const pending =
        isStockOutPendingCC(reqRow.status) ||
        isStockOutPendingFinance(reqRow.status) ||
        isStockOutPendingManager(reqRow.status);
      if (!pending) {
        throw new Error("Request already processed");
      }
      const row = await prisma.stockOutRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          decidedAt: new Date(),
          rejectionReason,
        },
      });
      return withVoucherDisplay(row);
    },

    rejectStockOutRequestsBatch: async (_, { ids, reason }, context) => {
      assertRole(context, ["CostControl"]);
      const rejectionReason = requireRejectionReason(reason);
      const unique = uniquePositiveIds(ids);
      if (!unique.length) return [];
      const rows = await prisma.stockOutRequest.findMany({
        where: { id: { in: unique } },
      });
      if (!rows.length) throw new Error("Request not found");
      if (!rows.every((r) => tenantHotelReadMatches(context, r.HotelName))) {
        throw new Error("Request not found");
      }
      if (!rows.every((r) => isStockOutPendingCC(r.status))) {
        throw new Error("One or more requests are not awaiting cost control check");
      }
      const now = new Date();
      const updated = await prisma.$transaction(
        unique.map((id) =>
          prisma.stockOutRequest.update({
            where: { id },
            data: {
              status: "REJECTED",
              decidedAt: now,
              rejectionReason,
            },
          }),
        ),
      );
      return updated.map(withVoucherDisplay);
    },

    checkItemRegistrationCC: async (
      _,
      { id, costControllerProfileId },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const row = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Registration not found");
      }
      if (row.approvalStatus !== "PENDING_CC") {
        throw new Error("Not awaiting cost control check");
      }
      const prof = await prisma.costControllerProfile.findFirst({
        where: { id: costControllerProfileId, HotelName: row.HotelName },
      });
      if (!prof) throw new Error("Select a registered cost controller identity");
      const updated = await prisma.itemRegistration.update({
        where: { id },
        data: {
          approvalStatus: "PENDING_FINANCE",
          ccProfileId: prof.id,
          ccActorName: prof.displayName,
          ccCheckedAt: new Date(),
          rejectionReason: null,
        },
      });
      return withVoucherDisplay(updated);
    },

    rejectItemRegistrationCC: async (_, { id, reason }, context) => {
      assertRole(context, ["CostControl"]);
      const rejectionReason = requireRejectionReason(reason);
      const row = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Registration not found");
      }
      if (row.approvalStatus !== "PENDING_CC") {
        throw new Error("Not awaiting cost control check");
      }
      const updated = await prisma.itemRegistration.update({
        where: { id },
        data: {
          approvalStatus: "REJECTED_CC",
          rejectionReason,
        },
      });
      return withVoucherDisplay(updated);
    },

    approveItemRegistrationFinance: async (_, { id }, context) => {
      assertRole(context, ["Finance"]);
      const row = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Registration not found");
      }
      if (row.approvalStatus !== "PENDING_FINANCE") {
        throw new Error("Not awaiting finance approval");
      }
      const updated = await prisma.itemRegistration.update({
        where: { id },
        data: {
          approvalStatus: "PENDING_MANAGER",
          financeApprovedAt: new Date(),
          financeActorName: context.user.UserName,
          rejectionReason: null,
        },
      });
      return withVoucherDisplay(updated);
    },

    rejectItemRegistrationFinance: async (_, { id, reason }, context) => {
      assertRole(context, ["Finance"]);
      const rejectionReason = requireRejectionReason(reason);
      const row = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Registration not found");
      }
      if (row.approvalStatus !== "PENDING_FINANCE") {
        throw new Error("Not awaiting finance approval");
      }
      const updated = await prisma.itemRegistration.update({
        where: { id },
        data: {
          approvalStatus: ITEM_REG_VOID,
          rejectionReason,
        },
      });
      return withVoucherDisplay(updated);
    },

    authorizeItemRegistrationManager: async (_, { id }, context) => {
      assertRole(context, ["Manager"]);
      const row = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Registration not found");
      }
      if (row.approvalStatus !== "PENDING_MANAGER") {
        throw new Error("Not awaiting manager authorization");
      }
      const updated = await prisma.itemRegistration.update({
        where: { id },
        data: {
          approvalStatus: "AUTHORIZED",
          managerAuthorizedAt: new Date(),
          managerActorName: context.user.UserName,
          rejectionReason: null,
        },
      });
      return withVoucherDisplay(updated);
    },

    rejectItemRegistrationManager: async (_, { id, reason }, context) => {
      assertRole(context, ["Manager"]);
      const rejectionReason = requireRejectionReason(reason);
      const row = await prisma.itemRegistration.findUnique({ where: { id } });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Registration not found");
      }
      if (row.approvalStatus !== "PENDING_MANAGER") {
        throw new Error("Not awaiting manager authorization");
      }
      const updated = await prisma.itemRegistration.update({
        where: { id },
        data: {
          approvalStatus: "REJECTED_MANAGER",
          rejectionReason,
        },
      });
      return withVoucherDisplay(updated);
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
        companyTinNumber,
        contactName,
        phoneNumber,
        email,
        payTiming,
        hotelCorporateCreditTierId,
        allowedMenuJson,
        dealNotes,
        imageUrl,
        creditLimit,
        paidAmount,
      },
      context,
    ) => {
      assertRole(context, ["HotelCashier", "Cashier"]);
      const tenant = tenantScopeFromContext(context);
      const tierId = Number(hotelCorporateCreditTierId);
      if (!tierId) throw new Error("Select a manager-defined credit tier");
      const tier = await prisma.hotelCorporateCreditTier.findUnique({
        where: { id: tierId },
      });
      if (!tier || !tenantHotelReadMatches(context, tier.HotelName)) {
        throw new Error("Credit tier not found");
      }
      const timing = String(payTiming || "AFTER_SERVICE").trim().toUpperCase();
      if (!["NOW", "AFTER_SERVICE"].includes(timing)) {
        throw new Error("payTiming must be NOW or AFTER_SERVICE");
      }
      const ceiling = Number(tier.creditCeiling);
      const requested =
        creditLimit != null ? Number(creditLimit) : ceiling;
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new Error("Requested credit must be greater than zero");
      }
      if (requested > ceiling + 1e-6) {
        throw new Error(
          `Requested credit cannot exceed tier maximum of ETB ${ceiling}`,
        );
      }
      const paid = paidAmount != null ? Number(paidAmount) : 0;
      if (paid < 0 || paid > requested + 1e-6) {
        throw new Error("Presale paid cannot exceed requested credit");
      }
      const logo = String(imageUrl || "").trim();
      if (!logo) throw new Error("Company logo or photo is required");
      return await prisma.hotelCreditCompany.create({
        data: {
          HotelName: tenant,
          companyName: String(companyName).trim(),
          companyTinNumber:
            companyTinNumber != null ? String(companyTinNumber).trim() : "",
          contactName: contactName != null ? String(contactName) : "",
          phoneNumber:
            phoneNumber != null ? String(phoneNumber).trim() : "",
          email: email != null ? String(email).trim() : "",
          payTiming: timing,
          approvalStatus: "PENDING_MANAGER",
          creditLevel: String(tier.name).trim(),
          creditLimit: requested,
          timeInterval: Number(tier.timeInterval),
          timeFrame: String(tier.timeFrame).trim(),
          hotelCorporateCreditTierId: tier.id,
          allowedMenuJson: String(allowedMenuJson || "[]"),
          dealNotes: dealNotes != null ? String(dealNotes) : "",
          imageUrl: logo,
          paidAmount: paid,
        },
      });
    },

    updateHotelCreditCompany: async (
      _,
      {
        id,
        companyName,
        companyTinNumber,
        contactName,
        phoneNumber,
        email,
        payTiming,
        hotelCorporateCreditTierId,
        allowedMenuJson,
        dealNotes,
        imageUrl,
        creditLimit,
        paidAmount,
      },
      context,
    ) => {
      assertRole(context, ["HotelCashier", "Cashier"]);
      const row = await prisma.hotelCreditCompany.findUnique({
        where: { id },
      });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Company not found");
      }
      let tierPatch = {};
      let ceiling = Number(row.creditLimit);
      if (hotelCorporateCreditTierId != null) {
        const tid = Number(hotelCorporateCreditTierId);
        const tier = await prisma.hotelCorporateCreditTier.findUnique({
          where: { id: tid },
        });
        if (!tier || !tenantHotelReadMatches(context, tier.HotelName)) {
          throw new Error("Credit tier not found");
        }
        ceiling = Number(tier.creditCeiling);
        tierPatch = {
          hotelCorporateCreditTierId: tier.id,
          creditLevel: String(tier.name).trim(),
          timeInterval: Number(tier.timeInterval),
          timeFrame: String(tier.timeFrame).trim(),
        };
      } else {
        const tier = row.hotelCorporateCreditTierId
          ? await prisma.hotelCorporateCreditTier.findUnique({
              where: { id: row.hotelCorporateCreditTierId },
            })
          : null;
        if (tier) ceiling = Number(tier.creditCeiling);
      }
      const requested =
        creditLimit != null ? Number(creditLimit) : Number(row.creditLimit);
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new Error("Requested credit must be greater than zero");
      }
      if (requested > ceiling + 1e-6) {
        throw new Error(
          `Requested credit cannot exceed tier maximum of ETB ${ceiling}`,
        );
      }
      const paid =
        paidAmount != null ? Number(paidAmount) : Number(row.paidAmount) || 0;
      if (paid < 0 || paid > requested + 1e-6) {
        throw new Error("Presale paid cannot exceed requested credit");
      }
      tierPatch = { ...tierPatch, creditLimit: requested, paidAmount: paid };
      const timing =
        payTiming != null
          ? String(payTiming).trim().toUpperCase()
          : row.payTiming;
      if (payTiming != null && !["NOW", "AFTER_SERVICE"].includes(timing)) {
        throw new Error("payTiming must be NOW or AFTER_SERVICE");
      }
      return await prisma.hotelCreditCompany.update({
        where: { id },
        data: {
          companyName: String(companyName).trim(),
          companyTinNumber:
            companyTinNumber != null
              ? String(companyTinNumber).trim()
              : row.companyTinNumber,
          contactName: contactName != null ? String(contactName) : "",
          phoneNumber:
            phoneNumber != null ? String(phoneNumber).trim() : row.phoneNumber,
          email: email != null ? String(email).trim() : "",
          payTiming: timing,
          allowedMenuJson: String(allowedMenuJson || "[]"),
          dealNotes: dealNotes != null ? String(dealNotes) : "",
          imageUrl: imageUrl != null ? String(imageUrl) : "",
          ...tierPatch,
        },
      });
    },

    authorizeHotelCreditCompany: async (_, { id }, context) => {
      assertRole(context, ["Manager", "Admin"]);
      const row = await prisma.hotelCreditCompany.findUnique({ where: { id } });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Company not found");
      }
      if (row.approvalStatus !== "PENDING_MANAGER") {
        throw new Error("Company is not awaiting authorization");
      }
      return await prisma.hotelCreditCompany.update({
        where: { id },
        data: {
          approvalStatus: "AUTHORIZED",
          managerActorName: context.user.UserName,
          managerAuthorizedAt: new Date(),
          rejectionReason: null,
        },
      });
    },

    rejectHotelCreditCompany: async (_, { id, reason }, context) => {
      assertRole(context, ["Manager", "Admin"]);
      const row = await prisma.hotelCreditCompany.findUnique({ where: { id } });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Company not found");
      }
      if (row.approvalStatus !== "PENDING_MANAGER") {
        throw new Error("Company is not awaiting authorization");
      }
      return await prisma.hotelCreditCompany.update({
        where: { id },
        data: {
          approvalStatus: "REJECTED",
          rejectionReason: reason ?? "",
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
      assertRole(context, ["HotelCashier", "Cashier"]);
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
      assertRole(context, ["HotelCashier", "Cashier"]);
      const cid = Number(companyId);
      const pid = partyId != null ? Number(partyId) : 0;
      const company = await prisma.hotelCreditCompany.findUnique({
        where: { id: cid },
      });
      if (!company || !tenantHotelReadMatches(context, company.HotelName)) {
        throw new Error("Company not found");
      }
      if (!isCompanyAuthorized(company)) {
        throw new Error(
          "Company must be authorized by the manager before recording usage",
        );
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
      assertRole(context, ["Manager", "Admin"]);
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
      assertRole(context, ["Manager", "Admin"]);
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
      assertRole(context, ["Manager", "Admin"]);
      const row = await prisma.hotelCorporateCreditTier.findUnique({
        where: { id },
      });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Tier not found");
      }
      await prisma.hotelCorporateCreditTier.delete({ where: { id } });
      return true;
    },

    CreateItemStatus: async(_, {name, imageUrl, category, amount, measuredBy, unitPrice, actionDate, supplierName, supplierPhone, Address, purchaseWithVat, supplierTinNumber, paidAmount, status, statusBy}, context) => {
      if (!context.user) throw new Error("Not Authorized")
      const tenant = tenantScopeFromContext(context);
      const { voucherNumber } = await allocateVoucherNumber(
        prisma,
        tenant,
        VOUCHER_TYPES.STOCK_MOVEMENT,
        tenantHotelKeysFromContext(context),
      );
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
          purchaseWithVat: isVatEnabled(purchaseWithVat),
          supplierTinNumber: String(supplierTinNumber ?? "").trim(),
          paidAmount: paidAmount,
          status: status,
          statusBy: statusBy,
          HotelName: tenant,
          voucherNumber,
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

/** Required for Vercel serverless — do not use app.listen() in production there. */
export default app;

if (!process.env.VERCEL) {
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}
