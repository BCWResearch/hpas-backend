-- CreateTable
CREATE TABLE "public"."ApiUserActionNonce" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ApiUserActionNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiUserActionNonce_expiresAt_idx" ON "public"."ApiUserActionNonce"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiUserActionNonce_nonce_key" ON "public"."ApiUserActionNonce"("nonce");
