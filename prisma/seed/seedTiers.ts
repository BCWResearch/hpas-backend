// prisma/seed.ts
import { PrismaClient, Tier } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.tierPlan.upsert({
    where: { name: "BASIC" as Tier },
    update: {},
    create: { name: "BASIC", requestLimit: 200, features: ["faucet:claim"] },
  });
  await prisma.tierPlan.upsert({
    where: { name: "ADVANCED" as Tier },
    update: {},
    create: { name: "ADVANCED", requestLimit: 5000, features: ["faucet:claim","passport:read"] },
  });
  await prisma.tierPlan.upsert({
    where: { name: "ENTERPRISE" as Tier },
    update: {},
    create: { name: "ENTERPRISE", requestLimit: 100000, features: ["autofaucet:drip", "faucet:check-EVM", "faucet:check-hedera", "faucet:drip", "passport:score", "faucet:transactions"] },
  });
}
main().finally(() => prisma.$disconnect());
