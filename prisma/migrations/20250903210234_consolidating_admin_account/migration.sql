/*
  Warnings:

  - You are about to drop the `AdminUser` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "public"."AdminUser";

-- CreateTable
CREATE TABLE "public"."AdminAccount" (
    "id" TEXT NOT NULL DEFAULT 'master',
    "walletEvm" TEXT,
    "walletHedera" TEXT,
    "role" TEXT NOT NULL DEFAULT 'SUPERADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccount_walletEvm_key" ON "public"."AdminAccount"("walletEvm");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccount_walletHedera_key" ON "public"."AdminAccount"("walletHedera");
