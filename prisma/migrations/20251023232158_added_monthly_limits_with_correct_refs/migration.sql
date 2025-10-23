/*
  Warnings:

  - The primary key for the `ApiUsageMonth` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "public"."ApiUsageMonth" DROP CONSTRAINT "ApiUsageMonth_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "partnerId" SET DATA TYPE TEXT,
ALTER COLUMN "apiKeyId" SET DATA TYPE TEXT,
ADD CONSTRAINT "ApiUsageMonth_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "ApiUsageMonth_id_seq";

-- CreateIndex
CREATE INDEX "ApiUsageMonth_partnerId_idx" ON "public"."ApiUsageMonth"("partnerId");

-- AddForeignKey
ALTER TABLE "public"."ApiUsageMonth" ADD CONSTRAINT "ApiUsageMonth_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiUsageMonth" ADD CONSTRAINT "ApiUsageMonth_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "public"."ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
