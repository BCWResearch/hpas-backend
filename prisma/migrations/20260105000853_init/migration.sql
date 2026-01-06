-- CreateEnum
CREATE TYPE "public"."PartnerUserRole" AS ENUM ('OWNER', 'ADMIN', 'VIEWER');

-- AlterTable
ALTER TABLE "public"."ApiKey" ADD COLUMN     "apiPartnerId" TEXT;

-- CreateTable
CREATE TABLE "public"."ApiPartner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "dripAmountInUsd" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "thresholdTriggered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApiPartnerUser" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "public"."PartnerUserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiPartnerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApiPartnerAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "ApiPartnerAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiPartner_name_key" ON "public"."ApiPartner"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ApiPartnerUser_partnerId_email_key" ON "public"."ApiPartnerUser"("partnerId", "email");

-- AddForeignKey
ALTER TABLE "public"."ApiKey" ADD CONSTRAINT "ApiKey_apiPartnerId_fkey" FOREIGN KEY ("apiPartnerId") REFERENCES "public"."ApiPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiPartnerUser" ADD CONSTRAINT "ApiPartnerUser_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."ApiPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
