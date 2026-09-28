import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDatabase } from "./seed-data";

async function main() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  try {
    if ((await prisma.user.count()) > 0) {
      console.log(`Database ${url} already seeded; skipping. Run "npm run db:reset" to start over.`);
      return;
    }
    const result = await seedDatabase(prisma);
    console.log(`Seeded ${Object.keys(result.users).length} users, ${result.caseCount} KYC cases, ${result.refundCount} refunds and ${result.disputeCount} disputes into ${url}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
