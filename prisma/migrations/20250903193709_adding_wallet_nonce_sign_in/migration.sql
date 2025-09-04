-- CreateEnum
CREATE TYPE "public"."MemberRole" AS ENUM ('OWNER', 'ADMIN', 'VIEWER');

-- AlterTable
ALTER TABLE "public"."PartnerAccount" ADD COLUMN     "isLoginIdentity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "role" "public"."MemberRole" NOT NULL DEFAULT 'OWNER';

-- CreateTable
CREATE TABLE "public"."WalletLoginNonce" (
    "id" TEXT NOT NULL,
    "type" "public"."AccountType" NOT NULL,
    "accountId" TEXT NOT NULL,
    "network" "public"."Network" NOT NULL DEFAULT 'MAINNET',
    "chainId" INTEGER,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "WalletLoginNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletLoginNonce_type_network_chainId_accountId_idx" ON "public"."WalletLoginNonce"("type", "network", "chainId", "accountId");

-- CreateIndex
CREATE INDEX "WalletLoginNonce_expiresAt_idx" ON "public"."WalletLoginNonce"("expiresAt");

-- CreateIndex
CREATE INDEX "PartnerAccount_isLoginIdentity_type_network_chainId_account_idx" ON "public"."PartnerAccount"("isLoginIdentity", "type", "network", "chainId", "accountId");
