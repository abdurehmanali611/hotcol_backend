/**
 * Cash/bank amount settlement plan (mirrors lib/cafeAmountPayment.ts).
 * Orders need: { id, price, orderAmount }.
 */

function roundMoney(amount) {
  return Math.round(amount * 100) / 100;
}

function lineTotal(order) {
  return (Number(order.price) || 0) * (Number(order.orderAmount) || 0);
}

function pickMaxSubsetWithinBudget(orders, primaryBudget) {
  if (orders.length === 0) {
    return { primaryOrders: [], secondaryOrders: [] };
  }

  const sorted = [...orders].sort((a, b) => a.id - b.id);
  const totals = sorted.map((o) => lineTotal(o));
  const n = sorted.length;
  const limit = 1 << n;

  let bestMask = 0;
  let bestSum = 0;

  for (let mask = 0; mask < limit; mask++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) sum += totals[i];
    }
    if (sum <= primaryBudget + 0.001 && sum > bestSum) {
      bestSum = sum;
      bestMask = mask;
    }
  }

  const primaryOrders = [];
  const secondaryOrders = [];
  for (let i = 0; i < n; i++) {
    if (bestMask & (1 << i)) primaryOrders.push(sorted[i]);
    else secondaryOrders.push(sorted[i]);
  }

  return { primaryOrders, secondaryOrders };
}

function partitionOrdersForPrimaryChannel(orders, primaryBudget, primaryChannel) {
  const { primaryOrders, secondaryOrders } = pickMaxSubsetWithinBudget(
    orders,
    primaryBudget,
  );
  if (primaryChannel === "cash") {
    return { cashOrders: primaryOrders, bankOrders: secondaryOrders };
  }
  return { cashOrders: secondaryOrders, bankOrders: primaryOrders };
}

function partitionOrdersForCashFirst(orders, cashBudget) {
  const { primaryOrders, secondaryOrders } = pickMaxSubsetWithinBudget(
    orders,
    cashBudget,
  );

  if (primaryOrders.length === 0 && cashBudget > 0.001 && orders.length > 0) {
    const smallest = [...orders].sort(
      (a, b) => lineTotal(a) - lineTotal(b),
    )[0];
    return {
      cashOrders: [smallest],
      bankOrders: orders.filter((order) => order.id !== smallest.id),
    };
  }

  return { cashOrders: primaryOrders, bankOrders: secondaryOrders };
}

function buildPlainBankChannels(orders) {
  return orders.map((order) => ({
    order,
    withBank: true,
  }));
}

function distributeBankTransferAcrossOrders(orders, totalTransferAmount) {
  if (!orders.length) return [];

  const rows = orders.map((order) => ({
    id: order.id,
    lineTotal: lineTotal(order),
  }));
  const batchTotal = rows.reduce((sum, row) => sum + row.lineTotal, 0);
  const tipTotal = Math.max(0, roundMoney(totalTransferAmount - batchTotal));

  const distributions = [];
  let assignedTransfer = 0;
  let assignedTip = 0;

  rows.forEach((row, index) => {
    const isLast = index === rows.length - 1;
    const share = batchTotal > 0 ? row.lineTotal / batchTotal : 1 / rows.length;
    const tipShare = isLast
      ? roundMoney(tipTotal - assignedTip)
      : roundMoney(tipTotal * share);
    const transferShare = isLast
      ? roundMoney(totalTransferAmount - assignedTransfer)
      : roundMoney(row.lineTotal + tipShare);

    assignedTip = roundMoney(assignedTip + tipShare);
    assignedTransfer = roundMoney(assignedTransfer + transferShare);

    distributions.push({
      id: row.id,
      bankTransferAmount: transferShare,
      bankTipCashDeduction: tipShare,
    });
  });

  return distributions;
}

function buildScaledBankChannels(orders, transferTotal) {
  if (orders.length === 0) return [];

  const lineSum = orders.reduce((sum, order) => sum + lineTotal(order), 0);

  if (Math.abs(transferTotal - lineSum) < 0.001) {
    return buildPlainBankChannels(orders);
  }

  const distributions = distributeBankTransferAcrossOrders(
    orders,
    transferTotal,
  );
  const distMap = new Map(distributions.map((d) => [d.id, d]));

  return orders.map((order) => {
    const dist = distMap.get(order.id);
    return {
      order,
      withBank: true,
      bankTransferAmount: dist?.bankTransferAmount ?? lineTotal(order),
      bankTipCashDeduction: dist?.bankTipCashDeduction ?? 0,
    };
  });
}

function buildCashFirstBankChannels(orders, requestedBank, cashSupplement) {
  if (orders.length === 0) return [];

  const lineSum = orders.reduce((sum, order) => sum + lineTotal(order), 0);
  const supplement = roundMoney(Math.max(0, cashSupplement));

  if (Math.abs(requestedBank - lineSum) < 0.001 && supplement < 0.001) {
    return buildPlainBankChannels(orders);
  }

  if (requestedBank > lineSum + 0.001) {
    return buildScaledBankChannels(orders, requestedBank);
  }

  const rows = orders.map((order) => ({
    order,
    lineTotal: lineTotal(order),
  }));

  let assignedTransfer = 0;
  let assignedSupplement = 0;

  return rows.map((row, index) => {
    const isLast = index === rows.length - 1;
    const share = lineSum > 0 ? row.lineTotal / lineSum : 1 / rows.length;

    const bankTransferAmount = isLast
      ? roundMoney(requestedBank - assignedTransfer)
      : roundMoney(requestedBank * share);

    const bankTipCashDeduction = isLast
      ? roundMoney(-(supplement - assignedSupplement))
      : roundMoney(-supplement * share);

    assignedTransfer = roundMoney(assignedTransfer + bankTransferAmount);
    assignedSupplement = roundMoney(
      assignedSupplement + Math.abs(bankTipCashDeduction),
    );

    return {
      order: row.order,
      withBank: true,
      bankTransferAmount,
      bankTipCashDeduction,
    };
  });
}

function buildSingleOrderMixedPlan(order, requestedCash, requestedBank) {
  const total = lineTotal(order);
  return {
    cashChannels: [],
    bankChannels: [
      {
        order,
        withBank: true,
        bankTransferAmount: roundMoney(requestedBank),
        bankTipCashDeduction: roundMoney(-requestedCash),
      },
    ],
    requestedCash: roundMoney(requestedCash),
    requestedBank: roundMoney(requestedBank),
    cashLineTotal: 0,
    bankLineTotal: roundMoney(total),
  };
}

function buildCashFirstAmountPlan(completedOrders, enteredAmount) {
  const total = completedOrders.reduce((sum, order) => sum + lineTotal(order), 0);
  const requestedCash = roundMoney(Math.max(0, Math.min(enteredAmount, total)));
  const requestedBank = roundMoney(Math.max(0, total - requestedCash));

  const { cashOrders, bankOrders } = partitionOrdersForCashFirst(
    completedOrders,
    requestedCash,
  );

  const cashLineTotal = cashOrders.reduce(
    (sum, order) => sum + lineTotal(order),
    0,
  );
  const bankLineTotal = bankOrders.reduce(
    (sum, order) => sum + lineTotal(order),
    0,
  );
  const cashSupplement = roundMoney(Math.max(0, requestedCash - cashLineTotal));

  return {
    cashChannels: cashOrders.map((order) => ({
      order,
      withBank: false,
    })),
    bankChannels: buildCashFirstBankChannels(
      bankOrders,
      requestedBank,
      cashSupplement,
    ),
    requestedCash,
    requestedBank,
    cashLineTotal: roundMoney(cashLineTotal),
    bankLineTotal: roundMoney(bankLineTotal),
  };
}

function buildBankFirstAmountPlan(completedOrders, enteredAmount) {
  const total = completedOrders.reduce((sum, order) => sum + lineTotal(order), 0);
  const requestedBank = roundMoney(Math.max(0, Math.min(enteredAmount, total)));
  const requestedCash = roundMoney(Math.max(0, total - requestedBank));

  const { cashOrders, bankOrders } = partitionOrdersForPrimaryChannel(
    completedOrders,
    requestedBank,
    "bank",
  );

  const cashLineTotal = cashOrders.reduce(
    (sum, order) => sum + lineTotal(order),
    0,
  );
  const bankLineTotal = bankOrders.reduce(
    (sum, order) => sum + lineTotal(order),
    0,
  );

  return {
    cashChannels: cashOrders.map((order) => ({
      order,
      withBank: false,
    })),
    bankChannels: buildScaledBankChannels(bankOrders, requestedBank),
    requestedCash,
    requestedBank,
    cashLineTotal: roundMoney(cashLineTotal),
    bankLineTotal: roundMoney(bankLineTotal),
  };
}

/**
 * @param {Array<{id:number,price:number,orderAmount:number}>} completedOrders
 * @param {number} enteredAmount primary channel amount
 * @param {"cash"|"bank"} primaryChannel
 */
export function buildAmountTablePaymentPlan(
  completedOrders,
  enteredAmount,
  primaryChannel,
) {
  if (completedOrders.length === 1) {
    const total = lineTotal(completedOrders[0]);
    const requestedPrimary = roundMoney(
      Math.max(0, Math.min(enteredAmount, total)),
    );
    const requestedSecondary = roundMoney(Math.max(0, total - requestedPrimary));
    const requestedCash =
      primaryChannel === "cash" ? requestedPrimary : requestedSecondary;
    const requestedBank =
      primaryChannel === "bank" ? requestedPrimary : requestedSecondary;

    if (requestedCash > 0.001 && requestedBank > 0.001) {
      return buildSingleOrderMixedPlan(
        completedOrders[0],
        requestedCash,
        requestedBank,
      );
    }
  }

  if (primaryChannel === "cash") {
    return buildCashFirstAmountPlan(completedOrders, enteredAmount);
  }
  return buildBankFirstAmountPlan(completedOrders, enteredAmount);
}

export function orderLineTotalETB(order) {
  return lineTotal(order);
}
