/**
 * Seed illustration CAFE tenants only:
 * - ItemRegistration (AUTHORIZED)
 * - StationIngredientStock (KITCHEN + BAR)
 * - Item.recipeJson for existing menu items
 *
 * Tenants:
 *   Apex Cafe and Restaurant      → 4DtJvzSwGnYL
 *   ApexAnalog cafe and restaurant → TIN_lXhLoXQVfEOXUVez
 *
 *   node scripts/seed-illustration-cafe-stock-recipes.mjs --dry-run
 *   node scripts/seed-illustration-cafe-stock-recipes.mjs --confirm
 */
import { createPrismaClient } from "../lib/prismaClient.js";

const CAFE_TENANTS = [
  {
    label: "Apex Cafe and Restaurant",
    tin: "4DtJvzSwGnYL",
    hotelKeys: [
      "4DtJvzSwGnYL",
      "Apex Cafe and Restaurant",
      "apex cafe and restaurant",
    ],
  },
  {
    label: "ApexAnalog cafe and restaurant",
    tin: "TIN_lXhLoXQVfEOXUVez",
    hotelKeys: [
      "TIN_lXhLoXQVfEOXUVez",
      "ApexAnalog cafe and restaurant",
      "apexanalog cafe and restaurant",
    ],
  },
];

/** @typedef {{ name: string, category: string, amount: number, measuredBy: string, unitPrice: number, station: 'KITCHEN'|'BAR'|'BOTH' }} StockRow */
/** @typedef {{ name: string, amount: number, measuredBy: string, unitPrice: number }} RecipeIng */

/** @type {StockRow[]} */
const STOCK = [
  { name: "ቡና|Buna|Coffee", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 800, station: "BAR" },
  { name: "ወተት|Wetet|Milk", category: "Food", amount: 40, measuredBy: "Litre", unitPrice: 80, station: "BOTH" },
  { name: "ስኳር|Sukar|Sugar", category: "Food", amount: 10, measuredBy: "Kilogram", unitPrice: 90, station: "BOTH" },
  { name: "ኤስፕሬሶ|Espresso|Espresso", category: "Food", amount: 3, measuredBy: "Kilogram", unitPrice: 1200, station: "BAR" },
  { name: "ለውዝ|Lewuz|Peanut / nut", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 350, station: "BAR" },
  { name: "አቮካዶ|Avocado|Avocado", category: "Food", amount: 30, measuredBy: "Piece", unitPrice: 40, station: "BAR" },
  { name: "ውሃ|Wuha|Water 1 liter", category: "Beverage", amount: 48, measuredBy: "Piece", unitPrice: 25, station: "BAR" },
  { name: "እንቁላል|Enqulal|Egg", category: "Food", amount: 60, measuredBy: "Piece", unitPrice: 12, station: "KITCHEN" },
  { name: "ቲማቲም|Timatim|Tomato", category: "Food", amount: 10, measuredBy: "Kilogram", unitPrice: 60, station: "KITCHEN" },
  { name: "ሽንኩርት|Shenkurt|Onion", category: "Food", amount: 10, measuredBy: "Kilogram", unitPrice: 50, station: "KITCHEN" },
  { name: "ነጭ ሽንኩርት|Nech Shnkurt|Garlic", category: "Food", amount: 3, measuredBy: "Kilogram", unitPrice: 120, station: "KITCHEN" },
  { name: "ዘይት|Zeyt|Oil", category: "Food", amount: 10, measuredBy: "Litre", unitPrice: 220, station: "KITCHEN" },
  { name: "ቅቤ|Kibe|Butter", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 450, station: "KITCHEN" },
  { name: "ድንች|Dinich|Potato", category: "Food", amount: 20, measuredBy: "Kilogram", unitPrice: 40, station: "KITCHEN" },
  { name: "ካሮት|Karot|Carrot", category: "Food", amount: 8, measuredBy: "Kilogram", unitPrice: 45, station: "KITCHEN" },
  { name: "ሰላጣ|Selata|Lettuce / salad greens", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 70, station: "KITCHEN" },
  { name: "ቁከምበር|Cucumber|Cucumber", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 50, station: "KITCHEN" },
  { name: "ስጋ|Sega|Meat", category: "Food", amount: 15, measuredBy: "Kilogram", unitPrice: 700, station: "KITCHEN" },
  { name: "መደበኛ የበሬ ስጋ|Medebeña Ye Bere Sega|Normal beef", category: "Food", amount: 10, measuredBy: "Kilogram", unitPrice: 750, station: "KITCHEN" },
  { name: "ቱና|Tuna|Tuna", category: "Food", amount: 20, measuredBy: "Piece", unitPrice: 90, station: "KITCHEN" },
  { name: "ሞዘሬላ ቺዝ|Mozzarella Cheese|Mozzarella cheese", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 900, station: "KITCHEN" },
  { name: "በርገር ቺዝ|Berger Cheese|Burger cheese", category: "Food", amount: 3, measuredBy: "Kilogram", unitPrice: 850, station: "KITCHEN" },
  { name: "በርገር ዳቦ|Berger Dabo|Burger bun", category: "Food", amount: 40, measuredBy: "Piece", unitPrice: 25, station: "KITCHEN" },
  { name: "ነጭ ዱቄት|Nech Duket|White flour", category: "Food", amount: 25, measuredBy: "Kilogram", unitPrice: 80, station: "KITCHEN" },
  { name: "የቲማቲም ፔስት|Ye Timatim Pest|Tomato paste", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 200, station: "KITCHEN" },
  { name: "የቲማቲም ፓስታ|Ye Timatim Pasta|Tomato pasta", category: "Food", amount: 5, measuredBy: "Kilogram", unitPrice: 180, station: "KITCHEN" },
  { name: "በርበሬ|Berbere|Red spice blend", category: "Food", amount: 2, measuredBy: "Kilogram", unitPrice: 400, station: "KITCHEN" },
  { name: "ማዮኔዝ|Mayonnaise|Mayonnaise", category: "Food", amount: 3, measuredBy: "Litre", unitPrice: 250, station: "KITCHEN" },
  { name: "ኬጨፕ|Ketchup|Ketchup", category: "Food", amount: 3, measuredBy: "Litre", unitPrice: 180, station: "KITCHEN" },
  { name: "የበሬ ሞርታዴላ|Ye Bere Mortadella|Beef mortadella", category: "Food", amount: 3, measuredBy: "Kilogram", unitPrice: 650, station: "KITCHEN" },
  { name: "እንጀራ|Injera|Sourdough flatbread", category: "Food", amount: 50, measuredBy: "Piece", unitPrice: 15, station: "KITCHEN" },
  { name: "አሉሚኒየም ፎይል|Aluminium Foil|Aluminium foil", category: "Others", amount: 10, measuredBy: "Packet", unitPrice: 120, station: "KITCHEN" },
];

function ing(name, amount, measuredBy, unitPrice) {
  return { name, amount, measuredBy, unitPrice };
}

const ATKLT_BASE = [
  ing("ቲማቲም|Timatim|Tomato", 0.1, "Kilogram", 60),
  ing("ሽንኩርት|Shenkurt|Onion", 0.05, "Kilogram", 50),
  ing("ካሮት|Karot|Carrot", 0.05, "Kilogram", 45),
  ing("ድንች|Dinich|Potato", 0.1, "Kilogram", 40),
  ing("ዘይት|Zeyt|Oil", 0.03, "Litre", 220),
  ing("በርበሬ|Berbere|Red spice blend", 0.005, "Kilogram", 400),
];

const PIZZA_BASE = [
  ing("ነጭ ዱቄት|Nech Duket|White flour", 0.2, "Kilogram", 80),
  ing("የቲማቲም ፔስት|Ye Timatim Pest|Tomato paste", 0.05, "Kilogram", 200),
  ing("ሞዘሬላ ቺዝ|Mozzarella Cheese|Mozzarella cheese", 0.12, "Kilogram", 900),
  ing("ሽንኩርት|Shenkurt|Onion", 0.04, "Kilogram", 50),
  ing("ዘይት|Zeyt|Oil", 0.02, "Litre", 220),
];

/** Match keys → recipe. Keys are normalized menu names. */
const RECIPE_BY_MENU = [
  {
    match: (n) => eq(n, "ቡና") || eq(n, "coffee"),
    recipe: [
      ing("ቡና|Buna|Coffee", 0.02, "Kilogram", 800),
      ing("ስኳር|Sukar|Sugar", 0.01, "Kilogram", 90),
    ],
  },
  {
    match: (n) => eq(n, "ማኪያቶ") || eq(n, "makiato") || eq(n, "macchiato"),
    recipe: [
      ing("ቡና|Buna|Coffee", 0.015, "Kilogram", 800),
      ing("ወተት|Wetet|Milk", 0.08, "Litre", 80),
      ing("ስኳር|Sukar|Sugar", 0.01, "Kilogram", 90),
    ],
  },
  {
    match: (n) => eq(n, "ወተት") || eq(n, "milk"),
    recipe: [
      ing("ወተት|Wetet|Milk", 0.25, "Litre", 80),
      ing("ስኳር|Sukar|Sugar", 0.01, "Kilogram", 90),
    ],
  },
  {
    match: (n) => n.includes("ለውዝ") && n.includes("ወተት"),
    recipe: [
      ing("ለውዝ|Lewuz|Peanut / nut", 0.05, "Kilogram", 350),
      ing("ወተት|Wetet|Milk", 0.25, "Litre", 80),
      ing("ስኳር|Sukar|Sugar", 0.02, "Kilogram", 90),
    ],
  },
  {
    match: (n) => n.includes("avocado") && n.includes("juice"),
    recipe: [
      ing("አቮካዶ|Avocado|Avocado", 1, "Piece", 40),
      ing("ወተት|Wetet|Milk", 0.15, "Litre", 80),
      ing("ስኳር|Sukar|Sugar", 0.02, "Kilogram", 90),
    ],
  },
  {
    match: (n) => n.includes("water") || eq(n, "ውሃ"),
    recipe: [ing("ውሃ|Wuha|Water 1 liter", 1, "Piece", 25)],
  },
  {
    match: (n) =>
      n.includes("atklt beenqulal") ||
      n.includes("አትክልት በእንቁላል") ||
      (n.includes("atklt") && n.includes("enqulal")),
    recipe: [ing("እንቁላል|Enqulal|Egg", 2, "Piece", 12), ...ATKLT_BASE],
  },
  {
    match: (n) =>
      eq(n, "atklt") ||
      (n.includes("atklt") &&
        !n.includes("besga") &&
        !n.includes("sand") &&
        !n.includes("enqulal") &&
        !n.includes("beenqulal")),
    recipe: [...ATKLT_BASE],
  },
  {
    match: (n) => n.includes("atklt besga") || n.includes("besga"),
    recipe: [...ATKLT_BASE, ing("ስጋ|Sega|Meat", 0.15, "Kilogram", 700)],
  },
  {
    match: (n) =>
      n.includes("club") ||
      n.includes("sandwitch") ||
      n.includes("sandwich") ||
      n.includes("atklt sand"),
    recipe: [
      ing("በርገር ዳቦ|Berger Dabo|Burger bun", 2, "Piece", 25),
      ing("እንቁላል|Enqulal|Egg", 1, "Piece", 12),
      ing("ቲማቲም|Timatim|Tomato", 0.05, "Kilogram", 60),
      ing("ሰላጣ|Selata|Lettuce / salad greens", 0.03, "Kilogram", 70),
      ing("የበሬ ሞርታዴላ|Ye Bere Mortadella|Beef mortadella", 0.05, "Kilogram", 650),
      ing("ማዮኔዝ|Mayonnaise|Mayonnaise", 0.02, "Litre", 250),
      ing("ቅቤ|Kibe|Butter", 0.01, "Kilogram", 450),
    ],
  },
  {
    match: (n) => n.includes("በርገር") || n.includes("burger"),
    recipe: [
      ing("በርገር ዳቦ|Berger Dabo|Burger bun", 1, "Piece", 25),
      ing("መደበኛ የበሬ ስጋ|Medebeña Ye Bere Sega|Normal beef", 0.15, "Kilogram", 750),
      ing("በርገር ቺዝ|Berger Cheese|Burger cheese", 0.03, "Kilogram", 850),
      ing("ቲማቲም|Timatim|Tomato", 0.04, "Kilogram", 60),
      ing("ሰላጣ|Selata|Lettuce / salad greens", 0.03, "Kilogram", 70),
      ing("ሽንኩርት|Shenkurt|Onion", 0.03, "Kilogram", 50),
      ing("ኬጨፕ|Ketchup|Ketchup", 0.02, "Litre", 180),
      ing("ማዮኔዝ|Mayonnaise|Mayonnaise", 0.015, "Litre", 250),
    ],
  },
  {
    match: (n) => n.includes("ቱና") && (n.includes("ፒዛ") || n.includes("pizza") || n.includes("piza")),
    recipe: [...PIZZA_BASE, ing("ቱና|Tuna|Tuna", 1, "Piece", 90)],
  },
  {
    match: (n) =>
      eq(n, "piza") ||
      n.includes("pizza") ||
      n.includes("ፒዛ") ||
      n.includes("beef pizza"),
    recipe: [
      ...PIZZA_BASE,
      ing("መደበኛ የበሬ ስጋ|Medebeña Ye Bere Sega|Normal beef", 0.1, "Kilogram", 750),
    ],
  },
  {
    match: (n) => n.includes("ሙሉ") || n.includes("አገልግል") || n.includes("full"),
    recipe: [
      ing("እንጀራ|Injera|Sourdough flatbread", 2, "Piece", 15),
      ing("ስጋ|Sega|Meat", 0.2, "Kilogram", 700),
      ing("ቲማቲም|Timatim|Tomato", 0.08, "Kilogram", 60),
      ing("ሽንኩርት|Shenkurt|Onion", 0.06, "Kilogram", 50),
      ing("በርበሬ|Berbere|Red spice blend", 0.01, "Kilogram", 400),
      ing("ዘይት|Zeyt|Oil", 0.03, "Litre", 220),
    ],
  },
  {
    match: (n) => n.includes("ፎይል") || n.includes("foil"),
    recipe: [ing("አሉሚኒየም ፎይል|Aluminium Foil|Aluminium foil", 1, "Packet", 120)],
  },
];

function norm(s) {
  return String(s || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function eq(a, b) {
  return norm(a) === norm(b);
}

function recipeForMenuName(menuName) {
  const n = norm(menuName);
  for (const row of RECIPE_BY_MENU) {
    if (row.match(n)) return { ingredients: row.recipe };
  }
  return null;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    confirm: argv.includes("--confirm"),
  };
}

async function seedTenant(prisma, tenant, dryRun) {
  const now = new Date();
  const expire = new Date(now);
  expire.setFullYear(expire.getFullYear() + 1);

  const summary = {
    label: tenant.label,
    tin: tenant.tin,
    registrationsDeleted: 0,
    registrationsCreated: 0,
    stationUpserts: 0,
    recipesUpdated: 0,
    recipesSkipped: [],
  };

  console.log(`\n=== ${tenant.label} (${tenant.tin}) ===`);

  const items = await prisma.item.findMany({
    where: { HotelName: { in: tenant.hotelKeys } },
    select: { id: true, name: true, category: true },
  });

  if (dryRun) {
    console.log(`Would seed ${STOCK.length} stock rows under HotelName=${tenant.tin}`);
    console.log(`Would update recipes for ${items.length} menu items:`);
    for (const item of items) {
      const recipe = recipeForMenuName(item.name);
      if (recipe) {
        console.log(`  ✓ ${item.name} → ${recipe.ingredients.length} ingredients`);
      } else {
        console.log(`  ✗ ${item.name} → no recipe match`);
        summary.recipesSkipped.push(item.name);
      }
    }
    return summary;
  }

  const stockNames = STOCK.map((s) => s.name);

  // Replace registrations for these crystal names under this TIN (bulk).
  const delReg = await prisma.itemRegistration.deleteMany({
    where: { HotelName: tenant.tin, name: { in: stockNames } },
  });
  summary.registrationsDeleted = delReg.count;

  const regRows = STOCK.map((stock) => ({
    name: stock.name,
    imageUrl: "",
    category: stock.category,
    amount: stock.amount,
    measuredBy: stock.measuredBy,
    unitPrice: stock.unitPrice,
    registrationDate: now,
    expireDate: expire,
    supplierName: "Illustration Supplier",
    supplierPhone: "",
    Address: "Addis Ababa",
    paidAmount: Number((stock.amount * stock.unitPrice).toFixed(2)),
    HotelName: tenant.tin,
    purchaseWithVat: false,
    supplierTinNumber: "",
    approvalStatus: "AUTHORIZED",
  }));
  const created = await prisma.itemRegistration.createMany({ data: regRows });
  summary.registrationsCreated = created.count;
  console.log(`  registrations: deleted ${delReg.count}, created ${created.count}`);

  // Do NOT seed Kitchen/Bar station stock — cashiers stay blocked until a real stock-out.
  const delStation = await prisma.stationIngredientStock.deleteMany({
    where: { HotelName: { in: tenant.hotelKeys } },
  });
  summary.stationUpserts = 0;
  console.log(
    `  station stock cleared (not seeded): deleted ${delStation.count} — order blocked until stock-out`,
  );

  for (const item of items) {
    const recipe = recipeForMenuName(item.name);
    if (!recipe) {
      summary.recipesSkipped.push(item.name);
      continue;
    }
    await prisma.item.update({
      where: { id: item.id },
      data: { recipeJson: recipe },
    });
    summary.recipesUpdated += 1;
    console.log(`  recipe ← ${item.name} (${recipe.ingredients.length} lines)`);
  }

  return summary;
}

async function main() {
  const { dryRun, confirm } = parseArgs(process.argv.slice(2));
  if (!dryRun && !confirm) {
    console.error("Pass --dry-run or --confirm");
    process.exit(1);
  }

  const prisma = createPrismaClient();
  try {
    // Safety: only cafe illustration TINs
    for (const t of CAFE_TENANTS) {
      if (!t.tin.includes("4DtJvzSwGnYL") && !t.tin.includes("TIN_lXhLoXQVfEOXUVez")) {
        throw new Error(`Unexpected tenant tin: ${t.tin}`);
      }
    }

    console.log(
      dryRun
        ? "DRY RUN — illustration cafe stock + recipes"
        : "CONFIRM — seeding illustration cafe stock + recipes",
    );

    const results = [];
    for (const tenant of CAFE_TENANTS) {
      results.push(await seedTenant(prisma, tenant, dryRun));
    }

    console.log("\n--- Summary ---");
    console.log(JSON.stringify(results, null, 2));
    if (dryRun) console.log("\nDry run only — nothing written.");
    else console.log("\nDone. Only illustration cafe tenants were touched.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
