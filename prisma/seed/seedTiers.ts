// prisma/seed.ts
import { PrismaClient, Tier } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.tierPlan.upsert({
    where: { name: "BASIC" as Tier },
    update: { features: ["faucet:check-EVM", "faucet:check-hedera", "faucet:claim", "faucet:drip", "passport:score", "faucet:transactions"] },
    create: { name: "BASIC", requestLimit: 200, features: ["faucet:check-EVM", "faucet:check-hedera", "faucet:drip", "passport:score", "faucet:transactions"] },
  });
  await prisma.tierPlan.upsert({
    where: { name: "ADVANCED" as Tier },
    update: { requestLimit: 1000, features: ["faucet:check-EVM", "faucet:check-hedera", "faucet:claim", "faucet:drip", "passport:score", "faucet:transactions"] },
    create: { name: "ADVANCED", requestLimit: 5000, features: ["faucet:check-EVM", "faucet:check-hedera", "faucet:drip", "passport:score", "faucet:transactions"] },
  });
  await prisma.tierPlan.upsert({
    where: { name: "ENTERPRISE" as Tier },
    update: { requestLimit: 5000, features: ["faucet:check-EVM", "faucet:check-hedera", "faucet:claim", "faucet:drip", "passport:score", "faucet:transactions"] },
    create: { name: "ENTERPRISE", requestLimit: 100000, features: ["faucet:check-EVM", "faucet:check-hedera", "faucet:drip", "passport:score", "faucet:transactions"] },
  });
}
main().finally(() => prisma.$disconnect());

// New plan: make custom limits for faucet and passport such that: 
//                                  faucetRequests are -> Free: 0, B: 200, A: 1000, E: 2500
//                                  scoreRequests are ->  Free: 0, B: 100, A: 1000, E: 5000   