// prisma/seed-admin.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    await prisma.adminAccount.upsert({
        where: { id: "master" },
        update: {
            walletEvm: "0xE746359b419Caf999a6e6cB4D6031B1867709B23",
            role: "SUPERADMIN",
        },
        create: {
            id: "master",
            walletHedera: "0.0.422755",
            walletEvm: "0xE746359b419Caf999a6e6cB4D6031B1867709B23",
            role: "SUPERADMIN",
        },
    });
    console.log("✅ Master admin account seeded");
}

main().finally(() => prisma.$disconnect());
