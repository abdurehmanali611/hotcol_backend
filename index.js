import express from "express";
import { ApolloServer, gql } from "apollo-server-express";
import cors from "cors";
import { PrismaClient } from "./generated/prisma/index.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { GraphQLJSON } from "graphql-scalars";

const prisma = new PrismaClient();
const JWT_Secret = process.env.JWT_Secret;

const typeDefs = gql`
  scalar JSON

  type User {
    id: Int!
    UserName: String!
    Password: String!
    HotelName: String!
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
    createdAt: String!
  }

  type cashouts {
    id: Int!
    Amount: Int!
    Reason: JSON
    HotelName: String!
    createdAt: Float!
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
    createdAt: Float!
  }

  input OrderInput {
    title: String!
    imageUrl: String!
    tableNo: Int!
    waiterName: String!
    orderAmount: Int!
    HotelName: String!
    category: String!
    type: String!
    price: Float!
    status: String
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
    createdAt: Float!
  }

  type table {
    id: Int!
    tableNo: Int!
    HotelName: String!
    status: [String]
    price: JSON
    payment: JSON
    capacity: Int!
    createdAt: Float!
  }

  type Query {
    users(HotelName: String): [User!]!
    items(HotelName: String): [Item!]!
    orders(HotelName: String): [Order!]!
    me: User
    waiters(HotelName: String): [waiter!]!
    tables(HotelName: String): [table!]!
    cashouts(HotelName: String): [cashouts!]!
  }

  type Mutation {
    Login(UserName: String!, Password: String!): AuthPayload!
    verifyAdminPassword(HotelName: String!, passwordInput: String!): Boolean
    UpdateAdminCredential(Password: String!, HotelName: String!): User!
    CreateAdmin(
      UserName: String!
      Password: String!
      Role: String!
      HotelName: String!
      LogoUrl: String!
    ): User!
    CreateCashout(
      Amount: Int!
      Reason: JSON
      HotelName: String!
    ): cashouts!
    UpdateCredential(
      UserName: String!
      Password: String!
      HotelName: String!
      Role: String!
    ): User!
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
      HotelName: String!
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
      HotelName: String!
      payment: String
      category: String!
      type: String!
      price: Float!
    ): Order!
    UpdatePayment(id: Int!, payment: String, withBank: Boolean): Order!
    DeleteItem(id: Int!): Item!
    UpdateItem(
      id: Int!
      name: String!
      category: String!
      price: Float!
      type: String!
      imageUrl: String!
      HotelName: String!
    ): Item!
    UpdateStatus(id: Int!, status: String): Order!
    CreateWaiter(
      name: String!
      HotelName: String!
      age: Int!
      sex: String!
      experience: Int!
      phoneNumber: String!
    ): waiter!
    CreateTable(tableNo: Int!, HotelName: String!, capacity: Int!): table!
    UpdatePaymentTable(
      id: Int!
      payment: JSON!
      price: JSON!
      HotelName: String!
    ): table!
    UpdatePaymentWaiter(
      id: Int!
      payment: JSON!
      price: JSON!
      tablesServed: JSON!
      HotelName: String!
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
      HotelName: String!
    ): waiter!
    UpdateTable(
      id: Int!
      tableNo: Int!
      capacity: Int!
      HotelName: String!
    ): table!
    BatchOrderCreation(orders: [OrderInput!]!): [Order!]!
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

const resolvers = {
  JSON: GraphQLJSON,
  Query: {
    users: async (_, { HotelName }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.user.findMany({
        where: { HotelName: HotelName },
      });
    },
    items: async (_, { HotelName }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.item.findMany({
        where: { HotelName: HotelName },
      });
    },
    orders: async (_, { HotelName }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.order.findMany({
        where: { HotelName: HotelName },
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
        },
      });
    },
    waiters: async (_, { HotelName }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.waiter.findMany({
        where: { HotelName: HotelName },
      });
    },
    tables: async (_, { HotelName }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.table.findMany({
        where: { HotelName: HotelName },
      });
    },
    cashouts: async (_, {HotelName}, context) => {
  if (!context.user) {
    throw new Error("Not Authenticated");
  }
  
  try {
    const whereClause = HotelName ? { HotelName: HotelName } : { HotelName: context.user.HotelName };
    
    const results = await prisma.cashouts.findMany({
      where: whereClause,
    });
    
    return results;
  } catch (error) {
    throw error;
  }
}
  },
  Mutation: {
    CreateAdmin: async (
      _,
      { UserName, Password, Role, HotelName, LogoUrl }
    ) => {
      const existingUser = await prisma.user.findUnique({
        where: { UserName: UserName, HotelName: HotelName },
      });
      if (existingUser) {
        throw new Error("User already exists");
      }

      const hashedPassword = await bcrypt.hash(Password, 12);
      return await prisma.user.create({
        data: { UserName, Password: hashedPassword, Role, HotelName, LogoUrl },
      });
    },
    CreateCashout: async (
      _,
      { Amount, Reason, HotelName },
      context
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.cashouts.create({
        data: { Amount, Reason, HotelName },
      });
    },
    Login: async (_, { UserName, Password }) => {
      const user = await prisma.user.findUnique({
        where: { UserName: UserName },
      });
      if (!user) throw new Error("No user found in this account");
      const valid = await bcrypt.compare(Password, user.Password);
      if (!valid) throw new Error("Invalid Password");
      const token = jwt.sign(
        {
          userId: user.id,
          UserName: user.UserName,
          Role: user.Role,
          HotelName: user.HotelName,
        },
        JWT_Secret,
        { expiresIn: "1d" }
      );
      return {
        token,
        user: {
          id: user.id,
          UserName: user.UserName,
          Role: user.Role,
          HotelName: user.HotelName,
          LogoUrl: user.LogoUrl,
        },
      };
    },
    verifyAdminPassword: async (_, { HotelName, passwordInput }) => {
      const admin = await prisma.user.findFirst({
        where: { HotelName: HotelName, Role: "Admin" },
      });
      if (!admin) return false;

      const isMatch = await bcrypt.compare(passwordInput, admin.Password);
      return isMatch;
    },
    CreateCredential: async (
      _,
      { UserName, Password, Role, HotelName, LogoUrl }
    ) => {
      const existingUser = await prisma.user.findUnique({
        where: { UserName: UserName },
      });

      if (existingUser) {
        throw new Error(
          "Username already exists. Please choose a different username."
        );
      }

      const hashedPassword = await bcrypt.hash(Password, 12);
      return await prisma.user.create({
        data: { UserName, Password: hashedPassword, HotelName, Role, LogoUrl },
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
                HotelName: orderData.HotelName,
                status: orderData.status || null,
                payment: orderData.payment || "Unpaid",
                category: orderData.category,
                type: orderData.type,
                price: orderData.price,
              },
            })
          )
        );

        return createdOrders;
      } catch (error) {
        throw error;
      }
    },
    UpdateAdminCredential: async (_, { Password, HotelName }, context) => {
      if (!context.user) throw new Error("Not Authenticated");

      const hashedPassword = await bcrypt.hash(Password, 12);

      const admin = await prisma.user.findFirst({
        where: { HotelName: HotelName, Role: "Admin" },
      });

      if (!admin) throw new Error("Admin not found");

      return await prisma.user.update({
        where: { id: admin.id },
        data: { Password: hashedPassword },
      });
    },

    UpdateCredential: async (
      _,
      { UserName, Password, HotelName, Role },
      context
    ) => {
      if (!context.user) throw new Error("Not Authenticated");

      const hashedPassword = await bcrypt.hash(Password, 12);

      const user = await prisma.user.findFirst({
        where: {
          HotelName: HotelName,
          Role: Role,
        },
      });

      if (!user) throw new Error("User not found");

      return await prisma.user.update({
        where: { id: user.id },
        data: {
          UserName: UserName,
          Password: hashedPassword,
        },
      });
    },
    CreateItem: async (
      _,
      { name, price, category, imageUrl, HotelName, type },
      context
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.item.create({
        data: {
          name,
          price,
          category,
          type,
          imageUrl,
          HotelName,
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
        HotelName,
        orderAmount,
      },
      context
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
            HotelName,
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
      return await prisma.order.update({
        where: { id: id },
        data: { payment: payment, withBank: withBank },
      });
    },
    DeleteItem: async (_, { id }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.item.delete({
        where: { id: id },
      });
    },
    UpdateItem: async (
      _,
      { id, name, category, price, imageUrl, HotelName, type },
      context
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      try {
        const updated = await prisma.item.update({
          where: { id: parseInt(id) },
          data: { name, price, category, type, imageUrl },
        });
        return updated;
      } catch (e) {
        throw e;
      }
    },
    UpdateStatus: async (_, { id, status }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.order.update({
        where: { id: id },
        data: {
          status: status,
        },
      });
    },
    CreateWaiter: async (
      _,
      { name, HotelName, age, sex, experience, phoneNumber },
      context
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.waiter.create({
        data: {
          name,
          HotelName,
          age,
          sex,
          experience,
          phoneNumber,
          price: [],
          tablesServed: [],
          payment: [],
        },
      });
    },
    CreateTable: async (_, { tableNo, HotelName, capacity }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.table.create({
        data: {
          tableNo,
          HotelName,
          capacity,
          price: [],
          payment: [],
        },
      });
    },
    UpdatePaymentWaiter: async (
      _,
      { HotelName, payment, price, tablesServed, id },
      context
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.waiter.update({
        where: { HotelName: HotelName, id: id },
        data: { payment: payment, price: price, tablesServed: tablesServed },
      });
    },
    UpdatePaymentTable: async (
      _,
      { id, payment, price, HotelName },
      context
    ) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.table.update({
        where: { id: id, HotelName: HotelName },
        data: { payment: payment, price: price },
      });
    },
    DeleteWaiter: async (_, { id }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.waiter.delete({
        where: { id: id },
      });
    },
    DeleteTable: async (_, { id }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.table.delete({
        where: { id: id },
      });
    },
    UpdateWaiter: async (
      _,
      { id, name, HotelName, age, sex, experience, phoneNumber },
      context
    ) => {
      if (!context.user) throw new Error("Not authenticated");
      return await prisma.waiter.update({
        where: { id: id, HotelName: HotelName },
        data: {
          name: name,
          age: age,
          sex: sex,
          experience: experience,
          phoneNumber: phoneNumber,
        },
      });
    },
    UpdateTable: async (_, { id, tableNo, capacity, HotelName }, context) => {
      if (!context.user) throw new Error("Not Authenticated");
      return await prisma.table.update({
        where: { id: id, HotelName: HotelName },
        data: { tableNo: tableNo, capacity: capacity },
      });
    },
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

  const port = 4000;
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

startServer();
