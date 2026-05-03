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
    paidAmount: Float!
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
    notes: String!
    createdAt: DateTime!
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
      monthPeriod: String!
      notes: String
    ): KitchenBarBeginning!

    updateKitchenBarBeginning(
      id: Int!
      station: String!
      itemName: String!
      amount: Float!
      measuredBy: String!
      monthPeriod: String!
      notes: String
    ): KitchenBarBeginning!

    deleteKitchenBarBeginning(id: Int!): Boolean!
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

const resolvers = {
  JSON: GraphQLJSON,
  DateTime: DateTimeResolver,
  StockOutRequest: {
    itemName: async (parent, _, { prisma }) => {
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
      return await prisma.itemRegistration.findMany({
        where: tenantHotelReadWhere(context),
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
      return await prisma.kitchenBarBeginning.findMany({
        where: tenantHotelReadWhere(context),
        orderBy: { createdAt: "desc" },
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
        { expiresIn: "1d" },
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
          movementType: String(movementType),
          amount: amt,
          stakeHolderOrReason: String(stakeHolderOrReason ?? "").trim(),
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
            decidedAt: new Date(),
            rejectionReason: null,
          },
        });
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
      { station, itemName, amount, measuredBy, monthPeriod, notes },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const tenant = tenantScopeFromContext(context);
      return await prisma.kitchenBarBeginning.create({
        data: {
          HotelName: tenant,
          station: String(station),
          itemName: String(itemName).trim(),
          amount,
          measuredBy,
          monthPeriod: String(monthPeriod).trim(),
          notes: notes ?? "",
        },
      });
    },

    updateKitchenBarBeginning: async (
      _,
      { id, station, itemName, amount, measuredBy, monthPeriod, notes },
      context,
    ) => {
      assertRole(context, ["CostControl"]);
      const row = await prisma.kitchenBarBeginning.findUnique({
        where: { id },
      });
      if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
        throw new Error("Record not found");
      }
      return await prisma.kitchenBarBeginning.update({
        where: { id },
        data: {
          station: String(station),
          itemName: String(itemName).trim(),
          amount,
          measuredBy,
          monthPeriod: String(monthPeriod).trim(),
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

    CreateItemStatus: async(_, {name, imageUrl, category, amount, measuredBy, unitPrice, actionDate, supplierName, supplierPhone, Address, supplierLevel, paidAmount, status, statusBy}, context) => {
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
