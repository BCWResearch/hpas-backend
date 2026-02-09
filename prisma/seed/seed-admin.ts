// prisma/seed-admin.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {

    await prisma.apiPartnerAdmin.createMany({
        data: [
            {email: 'sami@bcw.group'},
        ],
        skipDuplicates: true,
    });
    console.log("✅ Master admin account seeded");
}

main().finally(() => prisma.$disconnect());
