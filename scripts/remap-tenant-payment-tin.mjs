/**
 * Transfer billing / payment records from Gebretsadik Hotel and Spa (old TIN)
 * to Wa anga Trading plc(Gebretsadik Hotel) (new TIN) after legal renewal.
 *
 * Usage (from BackEnd/):
 *   node scripts/remap-tenant-payment-tin.mjs
 *   node scripts/remap-tenant-payment-tin.mjs --apply
 */
import { createPrismaClient } from "../lib/prismaClient.js";

const apply = process.argv.includes("--apply");

function argValue(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

function norm(v) {
  return String(v ?? "").trim();
}

const FROM = norm(argValue("--from", "0000610789"));
const TO = norm(argValue("--to", "0108492685"));

if (!FROM || !TO || FROM === TO) {
  console.error("Invalid --from / --to");
  process.exit(1);
}

const prisma = createPrismaClient();

/** Billing fields stored on the tenant owner (Admin/Manager) row. */
const BILLING_FIELDS = [
  "paymentChannel",
  "paymentTransactionRef",
  "setupFeeApproved",
  "subscriptionPaymentApproved",
  "setupFeeETB",
  "quarterlyFeeETB",
  "subscriptionPaidUntil",
  "paidQuartersCount",
  "billingHold",
  "billingStartedAt",
  "freeTrialEndsAt",
  "billingNotes",
  "feesManuallySet",
  "pricingRuleId",
  "isIllustrationTenant",
];

function mergeBilling(source, dest) {
  const out = {};
  for (const key of BILLING_FIELDS) {
    const s = source[key];
    const d = dest[key];
    if (key === "subscriptionPaidUntil") {
      const sT = s ? new Date(s).getTime() : 0;
      const dT = d ? new Date(d).getTime() : 0;
      out[key] = sT >= dT && s ? s : d ?? s ?? null;
      continue;
    }
    if (key === "paidQuartersCount") {
      out[key] = Math.max(Number(s) || 0, Number(d) || 0);
      continue;
    }
    if (key === "setupFeeApproved" || key === "subscriptionPaymentApproved") {
      out[key] = Boolean(s) || Boolean(d);
      continue;
    }
    if (key === "paymentChannel" || key === "paymentTransactionRef") {
      out[key] = norm(s) || norm(d) || null;
      continue;
    }
    if (key === "billingStartedAt") {
      out[key] = d ?? s ?? null;
      continue;
    }
    // Prefer source (legacy paid terms) when set.
    if (s !== null && s !== undefined && s !== "") {
      out[key] = s;
    } else {
      out[key] = d ?? null;
    }
  }
  return out;
}

async function findOwnerUser(tin) {
  return prisma.user.findFirst({
    where: { tinNumber: tin, Role: { in: ["Admin", "Manager"] } },
    orderBy: { id: "asc" },
  });
}

try {
  console.log(
    `${apply ? "APPLY" : "DRY-RUN"} payment/billing remap ${JSON.stringify(FROM)} → ${JSON.stringify(TO)}`,
  );

  const sourceOwner = await findOwnerUser(FROM);
  const destOwner = await findOwnerUser(TO);

  if (!sourceOwner) {
    console.error(`No Admin/Manager user found for source TIN ${FROM}`);
    process.exit(1);
  }
  if (!destOwner) {
    console.error(`No Admin/Manager user found for destination TIN ${TO}`);
    process.exit(1);
  }

  console.log(
    `Source owner: id=${sourceOwner.id} ${sourceOwner.UserName} (${sourceOwner.HotelName})`,
  );
  console.log(
    `Dest owner:   id=${destOwner.id} ${destOwner.UserName} (${destOwner.HotelName})`,
  );

  const merged = mergeBilling(sourceOwner, destOwner);
  console.log("\nMerged billing for destination Manager:");
  console.log(JSON.stringify(merged, null, 2));

  if (apply) {
    await prisma.user.update({
      where: { id: destOwner.id },
      data: merged,
    });
    console.log(`\nUpdated user id=${destOwner.id} (${destOwner.UserName})`);
  } else {
    console.log(`\nWould update user id=${destOwner.id} (${destOwner.UserName})`);
  }

  // Mirror setup-fee snapshot onto Store row (legacy pattern on old tenant).
  const sourceStore = await prisma.user.findFirst({
    where: { tinNumber: FROM, Role: "Store" },
  });
  const destStore = await prisma.user.findFirst({
    where: { tinNumber: TO, Role: "Store" },
  });
  if (sourceStore && destStore) {
    const storeData = {
      setupFeeApproved: sourceStore.setupFeeApproved,
      setupFeeETB: sourceStore.setupFeeETB,
      billingHold: sourceStore.billingHold,
      billingNotes: sourceStore.billingNotes,
    };
    console.log("\nStore row mirror:", storeData);
    if (apply) {
      await prisma.user.update({ where: { id: destStore.id }, data: storeData });
      console.log(`Updated Store user id=${destStore.id}`);
    }
  }

  const payCount = await prisma.tenant_payment_submission.count({
    where: { tinNumber: FROM },
  });
  console.log(`\ntenant_payment_submission rows to remap: ${payCount}`);
  if (payCount > 0) {
    if (apply) {
      const res = await prisma.tenant_payment_submission.updateMany({
        where: { tinNumber: FROM },
        data: { tinNumber: TO },
      });
      console.log(`  Remapped ${res.count} payment submission(s)`);
    }
  }

  const moduleReqCount = await prisma.tenant_module_change_request.count({
    where: { tinNumber: FROM },
  });
  console.log(`tenant_module_change_request rows to remap: ${moduleReqCount}`);
  if (moduleReqCount > 0 && apply) {
    const res = await prisma.tenant_module_change_request.updateMany({
      where: { tinNumber: FROM },
      data: { tinNumber: TO },
    });
    console.log(`  Remapped ${res.count} module change request(s)`);
  }

  const ownerLinks = await prisma.owner_property.findMany({
    where: { tinNumber: FROM },
    include: { owner: { select: { UserName: true } } },
  });
  console.log(`\nowner_property links on old TIN: ${ownerLinks.length}`);
  for (const link of ownerLinks) {
    console.log(
      `  id=${link.id} owner=${link.owner.UserName} → would set tinNumber=${TO}`,
    );
    if (apply) {
      const clash = await prisma.owner_property.findFirst({
        where: { ownerId: link.ownerId, tinNumber: TO },
      });
      if (clash) {
        await prisma.owner_property.delete({ where: { id: link.id } });
        console.log(`  Deleted duplicate link id=${link.id} (owner already linked to ${TO})`);
      } else {
        await prisma.owner_property.update({
          where: { id: link.id },
          data: { tinNumber: TO },
        });
        console.log(`  Updated link id=${link.id}`);
      }
    }
  }

  const oldThread = await prisma.tenant_feedback_thread.findUnique({
    where: { tinNumber: FROM },
  });
  const newThread = await prisma.tenant_feedback_thread.findUnique({
    where: { tinNumber: TO },
  });
  if (oldThread) {
    const msgCount = await prisma.tenant_feedback_message.count({
      where: { threadId: oldThread.id },
    });
    console.log(
      `\nFeedback thread on old TIN: id=${oldThread.id}, messages=${msgCount}`,
    );
    if (newThread && msgCount > 0) {
      if (apply) {
        await prisma.tenant_feedback_message.updateMany({
          where: { threadId: oldThread.id },
          data: { threadId: newThread.id },
        });
        await prisma.tenant_feedback_thread.delete({ where: { id: oldThread.id } });
        console.log(`  Moved ${msgCount} message(s) to thread id=${newThread.id}`);
      } else {
        console.log(
          `  Would move ${msgCount} message(s) to thread id=${newThread.id}`,
        );
      }
    } else if (!newThread && apply) {
      await prisma.tenant_feedback_thread.update({
        where: { id: oldThread.id },
        data: {
          tinNumber: TO,
          hotelDisplayName: destOwner.HotelName,
        },
      });
      console.log(`  Retargeted feedback thread to ${TO}`);
    }
  }

  // Clear billing on old tenant owner so Apex/owner apps don't double-count.
  const clearOld = {
    paymentChannel: null,
    paymentTransactionRef: null,
    setupFeeApproved: false,
    subscriptionPaymentApproved: false,
    subscriptionPaidUntil: null,
    paidQuartersCount: 0,
    billingHold: true,
    billingNotes: `Superseded by TIN ${TO} (${destOwner.HotelName})`,
  };
  console.log("\nClear old tenant owner billing:", clearOld);
  if (apply) {
    await prisma.user.update({ where: { id: sourceOwner.id }, data: clearOld });
    await prisma.tenant_account.updateMany({
      where: { tinNumber: FROM },
      data: { accountStatus: "suspended" },
    });
    console.log(`Suspended tenant_account for ${FROM}`);
  }

  console.log(
    apply
      ? "\nDone — payment/billing now on Wa anga Trading plc (Gebretsadik Hotel)."
      : "\nDry run complete. Re-run with --apply to commit.",
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
