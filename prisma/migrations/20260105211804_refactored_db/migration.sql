/*
  Warnings:

  - You are about to drop the column `partnerId` on the `ApiKey` table. All the data in the column will be lost.
  - You are about to drop the column `partnerId` on the `ApiRequestLog` table. All the data in the column will be lost.
  - You are about to drop the column `partnerId` on the `ApiUsageMonth` table. All the data in the column will be lost.
  - You are about to drop the column `partnerId` on the `ApiUsageWindow` table. All the data in the column will be lost.
  - You are about to drop the `ApiKeyAccount` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Partner` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PartnerAccount` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TierPlan` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `apiPartnerId` to the `ApiRequestLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `apiPartnerId` to the `ApiUsageMonth` table without a default value. This is not possible if the table is not empty.
  - Added the required column `apiPartnerId` to the `ApiUsageWindow` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."ApiKey" DROP CONSTRAINT "ApiKey_partnerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ApiKeyAccount" DROP CONSTRAINT "ApiKeyAccount_apiKeyId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ApiKeyAccount" DROP CONSTRAINT "ApiKeyAccount_partnerAccountId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ApiRequestLog" DROP CONSTRAINT "ApiRequestLog_partnerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ApiUsageMonth" DROP CONSTRAINT "ApiUsageMonth_partnerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ApiUsageWindow" DROP CONSTRAINT "ApiUsageWindow_partnerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PartnerAccount" DROP CONSTRAINT "PartnerAccount_partnerId_fkey";

-- DropIndex
DROP INDEX "public"."ApiRequestLog_partnerId_timestamp_idx";

-- DropIndex
DROP INDEX "public"."ApiUsageMonth_partnerId_idx";

-- DropIndex
DROP INDEX "public"."ApiUsageWindow_partnerId_windowStart_idx";

-- AlterTable
ALTER TABLE "public"."ApiKey" DROP COLUMN "partnerId";

-- AlterTable
ALTER TABLE "public"."ApiRequestLog" DROP COLUMN "partnerId",
ADD COLUMN     "apiPartnerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."ApiUsageMonth" DROP COLUMN "partnerId",
ADD COLUMN     "apiPartnerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."ApiUsageWindow" DROP COLUMN "partnerId",
ADD COLUMN     "apiPartnerId" TEXT NOT NULL;

-- DropTable
DROP TABLE "public"."ApiKeyAccount";

-- DropTable
DROP TABLE "public"."Partner";

-- DropTable
DROP TABLE "public"."PartnerAccount";

-- DropTable
DROP TABLE "public"."TierPlan";

-- CreateIndex
CREATE INDEX "ApiRequestLog_apiPartnerId_timestamp_idx" ON "public"."ApiRequestLog"("apiPartnerId", "timestamp");

-- CreateIndex
CREATE INDEX "ApiUsageMonth_apiPartnerId_idx" ON "public"."ApiUsageMonth"("apiPartnerId");

-- CreateIndex
CREATE INDEX "ApiUsageWindow_apiPartnerId_windowStart_idx" ON "public"."ApiUsageWindow"("apiPartnerId", "windowStart");

-- AddForeignKey
ALTER TABLE "public"."ApiUsageWindow" ADD CONSTRAINT "ApiUsageWindow_apiPartnerId_fkey" FOREIGN KEY ("apiPartnerId") REFERENCES "public"."ApiPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiRequestLog" ADD CONSTRAINT "ApiRequestLog_apiPartnerId_fkey" FOREIGN KEY ("apiPartnerId") REFERENCES "public"."ApiPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiUsageMonth" ADD CONSTRAINT "ApiUsageMonth_apiPartnerId_fkey" FOREIGN KEY ("apiPartnerId") REFERENCES "public"."ApiPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
