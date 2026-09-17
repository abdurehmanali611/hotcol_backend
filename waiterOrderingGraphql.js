/**
 * Waiter payment-approval GraphQL (Cashier resolve + Manager toggle).
 * Wired into BackEnd/index.js.
 */

import {
  buildAmountTablePaymentPlan,
  orderLineTotalETB,
} from "./cafeAmountPaymentPlan.js";

export const waiterOrderingTypeDefsBlock = `
  type WaiterPaymentApprovalRequest {
    id: Int!
    HotelName: String!
    waiterId: Int!
    waiterName: String!
    orderIds: JSON!
    tableNo: Int
    amountPaid: Float!
    paymentMethod: String!
    withBank: Boolean!
    status: String!
    requestNote: String
    cashierNote: String
    resolvedByUserName: String
    requestedAt: DateTime!
    resolvedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    """Sum of unpaid line totals covered by this request (computed)."""
    selectedTotal: Float
    """Amount that settles on the non-primary channel when partial (computed)."""
    remainderAmount: Float
    """Cash or Bank — the non-primary channel for remainder (computed)."""
    remainderMethod: String
    """True when amountPaid covers the full selected total (computed)."""
    fullyPaid: Boolean
  }
`;

export const waiterOrderingQueryFields = `
    pendingWaiterPaymentApprovals: [WaiterPaymentApprovalRequest!]!
    waiterPaymentApprovalRequest(id: Int!): WaiterPaymentApprovalRequest
`;

export const waiterOrderingMutationFields = `
    setWaiterPaymentApprovalEnabled(enabled: Boolean!): TenantSubscriptionSnapshot!
    resolveWaiterPaymentApproval(
      requestId: Int!
      approve: Boolean!
      cashierNote: String
      bankTransferAmount: Float
      bankTipCashDeduction: Float
    ): WaiterPaymentApprovalRequest!
`;

function parseOrderIdList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  }
  if (typeof raw === "string") {
    try {
      return parseOrderIdList(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function paymentMethodToWithBank(method) {
  const m = String(method || "").trim().toLowerCase();
  if (m === "bank" || m === "withbank" || m === "transfer") return true;
  return false;
}

async function enrichApprovalRequest(prisma, row) {
  if (!row) return row;
  const orderIds = parseOrderIdList(row.orderIds);
  let selectedTotal = 0;
  if (orderIds.length) {
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds }, HotelName: row.HotelName },
      select: { price: true, orderAmount: true, payment: true },
    });
    selectedTotal = orders
      .filter((o) => String(o.payment || "").toLowerCase() !== "paid")
      .reduce((sum, o) => sum + orderLineTotalETB(o), 0);
    if (selectedTotal <= 0) {
      selectedTotal = orders.reduce((sum, o) => sum + orderLineTotalETB(o), 0);
    }
  }
  const primaryAmount = Number(row.amountPaid) || 0;
  const primaryWithBank =
    row.withBank === true || paymentMethodToWithBank(row.paymentMethod);
  const fullyPaid = primaryAmount >= selectedTotal - 0.001 && selectedTotal > 0;
  const remainderAmount = Math.max(
    0,
    Math.round((selectedTotal - Math.min(primaryAmount, selectedTotal)) * 100) /
      100,
  );
  return {
    ...row,
    selectedTotal: Math.round(selectedTotal * 100) / 100,
    remainderAmount: fullyPaid ? 0 : remainderAmount,
    remainderMethod: primaryWithBank ? "Cash" : "Bank",
    fullyPaid: fullyPaid || selectedTotal <= 0,
  };
}

/**
 * @param {object} deps
 */
export function createWaiterOrderingResolvers(deps) {
  const {
    prisma,
    assertAdminOrManager,
    tenantScopeFromContext,
    tenantHotelReadMatches,
    resolveTenantSubscription,
    parseModulesJson,
    parseCafeOrderMode,
    initialCafeOrderModeHistory,
    loadGraphqlTenantSubscription,
    loadAuthUserFromDb,
    enrichContextUser,
    roleIsOneOf,
    loadTenantCafeOrderMode,
    isRoomServiceTableNo,
  } = deps;

  async function applyPaidToOrder(
    authCtx,
    order,
    { withBank, bankTransferAmount, bankTipCashDeduction },
  ) {
    const data = {
      payment: "Paid",
      withBank: Boolean(withBank),
      paymentApprovalRequestId: null,
    };
    if (!withBank) {
      data.bankTransferAmount = null;
      data.bankTipCashDeduction = null;
    } else {
      if (bankTransferAmount != null) data.bankTransferAmount = bankTransferAmount;
      if (bankTipCashDeduction != null) {
        data.bankTipCashDeduction = bankTipCashDeduction;
      }
    }
    const isRoomService = isRoomServiceTableNo(order.tableNo);
    if (
      String(order.status || "").toLowerCase() !== "cancelled" &&
      String(order.status || "").toLowerCase() !== "failed"
    ) {
      const analogPaid =
        (await loadTenantCafeOrderMode(
          prisma,
          tenantScopeFromContext(authCtx),
        )) === "analog";
      if (isRoomService || analogPaid) {
        data.status = "Completed";
      }
    }
    return prisma.order.update({ where: { id: order.id }, data });
  }

  return {
    Query: {
      pendingWaiterPaymentApprovals: async (_, __, context) => {
        if (!context.user) throw new Error("Not Authenticated");
        const dbUser = await loadAuthUserFromDb(context, prisma);
        const authCtx = enrichContextUser(context, dbUser);
        if (
          !roleIsOneOf(authCtx.user, [
            "Cashier",
            "Admin",
            "Manager",
            "HotelCashier",
          ])
        ) {
          throw new Error("Not authorized");
        }
        const tin = tenantScopeFromContext(authCtx);
        const rows = await prisma.waiter_payment_approval_request.findMany({
          where: { HotelName: tin, status: "pending" },
          orderBy: { requestedAt: "desc" },
        });
        return Promise.all(rows.map((row) => enrichApprovalRequest(prisma, row)));
      },
      waiterPaymentApprovalRequest: async (_, { id }, context) => {
        if (!context.user) throw new Error("Not Authenticated");
        const row = await prisma.waiter_payment_approval_request.findUnique({
          where: { id },
        });
        if (!row || !tenantHotelReadMatches(context, row.HotelName)) {
          throw new Error("Request not found or not authorized");
        }
        return enrichApprovalRequest(prisma, row);
      },
    },
    Mutation: {
      setWaiterPaymentApprovalEnabled: async (_, { enabled }, context) => {
        if (!context.user) throw new Error("Not Authenticated");
        assertAdminOrManager(context);
        const tin = tenantScopeFromContext(context);
        if (!tin) throw new Error("Tenant scope missing");

        const owner =
          (await prisma.user.findFirst({
            where: { tinNumber: tin, Role: { in: ["Admin", "Manager"] } },
            orderBy: { id: "asc" },
          })) ||
          (await prisma.user.findUnique({
            where: { id: context.user.userId },
          }));
        if (!owner) throw new Error("Tenant owner not found");

        const subscription = await resolveTenantSubscription(prisma, owner);
        if (!subscription.waiterOrderingEnabled && enabled) {
          throw new Error(
            "Waiter ordering is not permitted for this property. Contact HotCol Apex.",
          );
        }
        const current = parseModulesJson(subscription.modules);
        const currentMode = parseCafeOrderMode(subscription.cafeOrderMode);

        await prisma.tenant_account.upsert({
          where: { tinNumber: tin },
          create: {
            tinNumber: tin,
            hotelDisplayName: String(owner.HotelName || "").trim() || tin,
            businessType: owner.businessType ?? null,
            logoUrl: owner.LogoUrl ?? null,
            modules: current,
            cafeOrderMode: currentMode,
            cafeOrderModeHistory: initialCafeOrderModeHistory(
              currentMode,
              owner.createdAt,
            ),
            waiterPaymentApprovalEnabled: Boolean(enabled),
            waiterOrderingEnabled: Boolean(subscription.waiterOrderingEnabled),
            accountStatus: "active",
          },
          update: { waiterPaymentApprovalEnabled: Boolean(enabled) },
        });

        return loadGraphqlTenantSubscription(prisma, owner);
      },

      resolveWaiterPaymentApproval: async (
        _,
        {
          requestId,
          approve,
          cashierNote,
          bankTransferAmount,
          bankTipCashDeduction,
        },
        context,
      ) => {
        if (!context.user) throw new Error("Not Authenticated");
        const dbUser = await loadAuthUserFromDb(context, prisma);
        const authCtx = enrichContextUser(context, dbUser);
        if (
          !roleIsOneOf(authCtx.user, [
            "Cashier",
            "Admin",
            "Manager",
            "HotelCashier",
          ])
        ) {
          throw new Error(
            "Not authorized — only cashiers can resolve payment approvals",
          );
        }

        const request = await prisma.waiter_payment_approval_request.findUnique({
          where: { id: requestId },
        });
        if (!request || !tenantHotelReadMatches(authCtx, request.HotelName)) {
          throw new Error("Request not found or not authorized");
        }
        if (String(request.status) !== "pending") {
          throw new Error("This payment approval request is no longer pending");
        }

        const orderIds = parseOrderIdList(request.orderIds);
        const note =
          cashierNote != null && String(cashierNote).trim() !== ""
            ? String(cashierNote).trim()
            : null;
        const resolverName =
          String(authCtx.user.UserName || authCtx.user.userName || "").trim() ||
          "Cashier";

        if (!approve) {
          await prisma.$transaction([
            prisma.waiter_payment_approval_request.update({
              where: { id: request.id },
              data: {
                status: "rejected",
                cashierNote: note,
                resolvedByUserName: resolverName,
                resolvedAt: new Date(),
              },
            }),
            ...(orderIds.length
              ? [
                  prisma.order.updateMany({
                    where: {
                      id: { in: orderIds },
                      HotelName: request.HotelName,
                    },
                    data: { paymentApprovalRequestId: null },
                  }),
                ]
              : []),
          ]);
          return prisma.waiter_payment_approval_request.findUnique({
            where: { id: request.id },
          });
        }

        const primaryWithBank =
          request.withBank === true ||
          paymentMethodToWithBank(request.paymentMethod);
        const orders = orderIds.length
          ? await prisma.order.findMany({
              where: {
                id: { in: orderIds },
                HotelName: request.HotelName,
              },
            })
          : [];

        const unpaid = orders.filter(
          (order) => String(order.payment || "").toLowerCase() !== "paid",
        );
        const selectedTotal = unpaid.reduce(
          (sum, order) => sum + orderLineTotalETB(order),
          0,
        );
        const primaryAmount = Number(request.amountPaid);
        const isFullyPaid =
          Number.isFinite(primaryAmount) &&
          primaryAmount >= selectedTotal - 0.001;

        if (isFullyPaid || unpaid.length === 0) {
          for (const order of unpaid) {
            await applyPaidToOrder(authCtx, order, {
              withBank: primaryWithBank,
              bankTransferAmount:
                bankTransferAmount != null ? bankTransferAmount : undefined,
              bankTipCashDeduction:
                bankTipCashDeduction != null
                  ? bankTipCashDeduction
                  : undefined,
            });
          }
        } else {
          const primaryChannel = primaryWithBank ? "bank" : "cash";
          const plan = buildAmountTablePaymentPlan(
            unpaid,
            primaryAmount,
            primaryChannel,
          );
          const channels = [...plan.cashChannels, ...plan.bankChannels];
          for (const channel of channels) {
            await applyPaidToOrder(authCtx, channel.order, {
              withBank: channel.withBank,
              bankTransferAmount: channel.bankTransferAmount,
              bankTipCashDeduction: channel.bankTipCashDeduction,
            });
          }
        }

        return prisma.waiter_payment_approval_request.update({
          where: { id: request.id },
          data: {
            status: "approved",
            cashierNote: note,
            resolvedByUserName: resolverName,
            resolvedAt: new Date(),
            withBank: primaryWithBank,
          },
        });
      },
    },
  };
}

export function normalizeWaiterPasskey(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  if (!/^\d{6}$/.test(s)) {
    throw new Error("Passkey must be exactly 6 digits");
  }
  return s;
}

export async function assertPasskeyAvailable(
  prisma,
  passkey,
  excludeWaiterId = null,
) {
  if (!passkey) return;
  const existing = await prisma.waiter.findFirst({
    where: {
      passkey,
      ...(excludeWaiterId != null ? { id: { not: excludeWaiterId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error(
      "This passkey is already assigned to another waiter (must be unique across all properties)",
    );
  }
}
