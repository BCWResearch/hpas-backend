/*
  Warnings:

  - You are about to drop the column `email` on the `ApiPartnerUser` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[partnerId,accountId]` on the table `ApiPartnerUser` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `accountId` to the `ApiPartnerUser` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."ApiPartnerUser_partnerId_email_key";

-- AlterTable
ALTER TABLE "public"."ApiPartnerUser" DROP COLUMN "email",
ADD COLUMN     "accountId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "public"."Email" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiPartnerUser_partnerId_accountId_key" ON "public"."ApiPartnerUser"("partnerId", "accountId");

-- AddForeignKey
ALTER TABLE "public"."Email" ADD CONSTRAINT "Email_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."ApiPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
