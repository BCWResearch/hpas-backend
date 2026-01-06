/*
  Warnings:

  - Made the column `apiPartnerId` on table `ApiKey` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "public"."ApiKey" DROP CONSTRAINT "ApiKey_apiPartnerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ApiKey" DROP CONSTRAINT "ApiKey_partnerId_fkey";

-- DropIndex
DROP INDEX "public"."ApiKey_partnerId_idx";

-- AlterTable
ALTER TABLE "public"."ApiKey" ALTER COLUMN "partnerId" DROP NOT NULL,
ALTER COLUMN "apiPartnerId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ApiKey_apiPartnerId_idx" ON "public"."ApiKey"("apiPartnerId");

-- AddForeignKey
ALTER TABLE "public"."ApiKey" ADD CONSTRAINT "ApiKey_apiPartnerId_fkey" FOREIGN KEY ("apiPartnerId") REFERENCES "public"."ApiPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiKey" ADD CONSTRAINT "ApiKey_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
