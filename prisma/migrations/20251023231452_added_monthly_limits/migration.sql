/*
  Warnings:

  - You are about to drop the `LockState` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "public"."LockState";

-- CreateTable
CREATE TABLE "public"."ApiUsageMonth" (
    "id" SERIAL NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "apiKeyId" INTEGER NOT NULL,
    "monthStart" TIMESTAMP(3) NOT NULL,
    "monthEnd" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApiUsageMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiUsageMonth_apiKeyId_monthStart_monthEnd_key" ON "public"."ApiUsageMonth"("apiKeyId", "monthStart", "monthEnd");
