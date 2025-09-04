-- CreateTable
CREATE TABLE "public"."AdminUser" (
    "id" TEXT NOT NULL,
    "walletEvm" TEXT,
    "walletHedera" TEXT,
    "role" "public"."MemberRole" NOT NULL DEFAULT 'OWNER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdminLoginNonce" (
    "id" TEXT NOT NULL,
    "kind" "public"."AccountType" NOT NULL,
    "accountId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "AdminLoginNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_walletEvm_key" ON "public"."AdminUser"("walletEvm");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_walletHedera_key" ON "public"."AdminUser"("walletHedera");

-- CreateIndex
CREATE INDEX "AdminLoginNonce_kind_accountId_expiresAt_idx" ON "public"."AdminLoginNonce"("kind", "accountId", "expiresAt");
