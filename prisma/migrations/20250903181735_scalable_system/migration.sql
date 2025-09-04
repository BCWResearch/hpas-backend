/*
  Warnings:

  - You are about to drop the column `scopes` on the `ApiKey` table. All the data in the column will be lost.
  - Added the required column `type` to the `ApiKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Partner` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."AccountType" AS ENUM ('EVM', 'HEDERA');

-- CreateEnum
CREATE TYPE "public"."Network" AS ENUM ('MAINNET', 'TESTNET');

-- CreateEnum
CREATE TYPE "public"."KeyEnv" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "public"."KeyType" AS ENUM ('FAUCET', 'HASHPASS');

-- CreateEnum
CREATE TYPE "public"."Tier" AS ENUM ('BASIC', 'ADVANCED', 'ENTERPRISE');

-- DropForeignKey
ALTER TABLE "public"."ApiKey" DROP CONSTRAINT "ApiKey_partnerId_fkey";

-- AlterTable
ALTER TABLE "public"."ApiKey" DROP COLUMN "scopes",
ADD COLUMN     "env" "public"."KeyEnv" NOT NULL DEFAULT 'LIVE',
ADD COLUMN     "type" "public"."KeyType" NOT NULL;

-- AlterTable
ALTER TABLE "public"."Partner" ADD COLUMN     "requestLimitOverride" INTEGER,
ADD COLUMN     "tier" "public"."Tier" NOT NULL DEFAULT 'BASIC',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "public"."PartnerAccount" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" "public"."AccountType" NOT NULL,
    "accountId" TEXT NOT NULL,
    "network" "public"."Network" NOT NULL DEFAULT 'MAINNET',
    "chainId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApiKeyScope" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,

    CONSTRAINT "ApiKeyScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TierPlan" (
    "id" TEXT NOT NULL,
    "name" "public"."Tier" NOT NULL,
    "requestLimit" INTEGER NOT NULL,
    "features" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TierPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RateLimitPolicy" (
    "id" TEXT NOT NULL,
    "tier" "public"."Tier" NOT NULL,
    "route" TEXT NOT NULL,
    "windowSeconds" INTEGER NOT NULL,
    "maxRequests" INTEGER NOT NULL,

    CONSTRAINT "RateLimitPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApiUsageWindow" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApiUsageWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApiRequestLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partnerId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "costUnits" INTEGER NOT NULL DEFAULT 1,
    "ipHash" TEXT,

    CONSTRAINT "ApiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerAccount_partnerId_idx" ON "public"."PartnerAccount"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerAccount_type_accountId_idx" ON "public"."PartnerAccount"("type", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAccount_type_network_chainId_accountId_key" ON "public"."PartnerAccount"("type", "network", "chainId", "accountId");

-- CreateIndex
CREATE INDEX "ApiKeyScope_apiKeyId_idx" ON "public"."ApiKeyScope"("apiKeyId");

-- CreateIndex
CREATE INDEX "ApiKeyScope_scope_idx" ON "public"."ApiKeyScope"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyScope_apiKeyId_scope_key" ON "public"."ApiKeyScope"("apiKeyId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "TierPlan_name_key" ON "public"."TierPlan"("name");

-- CreateIndex
CREATE INDEX "RateLimitPolicy_tier_idx" ON "public"."RateLimitPolicy"("tier");

-- CreateIndex
CREATE INDEX "RateLimitPolicy_route_idx" ON "public"."RateLimitPolicy"("route");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitPolicy_tier_route_windowSeconds_key" ON "public"."RateLimitPolicy"("tier", "route", "windowSeconds");

-- CreateIndex
CREATE INDEX "ApiUsageWindow_partnerId_windowStart_idx" ON "public"."ApiUsageWindow"("partnerId", "windowStart");

-- CreateIndex
CREATE INDEX "ApiUsageWindow_route_windowStart_idx" ON "public"."ApiUsageWindow"("route", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "ApiUsageWindow_apiKeyId_route_windowStart_windowEnd_key" ON "public"."ApiUsageWindow"("apiKeyId", "route", "windowStart", "windowEnd");

-- CreateIndex
CREATE INDEX "ApiRequestLog_partnerId_timestamp_idx" ON "public"."ApiRequestLog"("partnerId", "timestamp");

-- CreateIndex
CREATE INDEX "ApiRequestLog_apiKeyId_timestamp_idx" ON "public"."ApiRequestLog"("apiKeyId", "timestamp");

-- CreateIndex
CREATE INDEX "ApiRequestLog_route_timestamp_idx" ON "public"."ApiRequestLog"("route", "timestamp");

-- CreateIndex
CREATE INDEX "ApiKey_partnerId_idx" ON "public"."ApiKey"("partnerId");

-- CreateIndex
CREATE INDEX "ApiKey_revoked_expiresAt_idx" ON "public"."ApiKey"("revoked", "expiresAt");

-- CreateIndex
CREATE INDEX "Partner_name_idx" ON "public"."Partner"("name");

-- AddForeignKey
ALTER TABLE "public"."PartnerAccount" ADD CONSTRAINT "PartnerAccount_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiKey" ADD CONSTRAINT "ApiKey_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiKeyScope" ADD CONSTRAINT "ApiKeyScope_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "public"."ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiUsageWindow" ADD CONSTRAINT "ApiUsageWindow_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiUsageWindow" ADD CONSTRAINT "ApiUsageWindow_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "public"."ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiRequestLog" ADD CONSTRAINT "ApiRequestLog_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiRequestLog" ADD CONSTRAINT "ApiRequestLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "public"."ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
