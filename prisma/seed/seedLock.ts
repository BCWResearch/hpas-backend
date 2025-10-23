import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.lockState.upsert({
    where: { id: 'lock' },
    update: {},
    create: { id: "lock", faucet_paused: false },
  });
}
main().finally(() => prisma.$disconnect());