import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.itemRegistration.updateMany({
    where: { approvalStatus: "PENDING_CC" },
    data: { approvalStatus: "AUTHORIZED" },
  });
  const pr = await prisma.purchaseRequest.updateMany({
    where: { status: "APPROVED_FINANCE" },
    data: { status: "AUTHORIZED" },
  });
  const stock = await prisma.stockOutRequest.updateMany({
    where: { status: "PENDING" },
    data: { status: "PENDING_CC" },
  });
  const companies = await prisma.hotelCreditCompany.updateMany({
    where: { approvalStatus: "PENDING_MANAGER" },
    data: { approvalStatus: "AUTHORIZED" },
  });
  console.log({
    itemRegistrations: items.count,
    purchaseRequests: pr.count,
    stockPending: stock.count,
    companies: companies.count,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
