-- CreateTable
CREATE TABLE "public"."ApiUserLoginNonce" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ApiUserLoginNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiUserLoginNonce_expiresAt_idx" ON "public"."ApiUserLoginNonce"("expiresAt");
