-- CreateTable
CREATE TABLE "public"."SecureTokenJti" (
    "jti" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "partnerId" TEXT,
    "memberId" TEXT,
    "adminId" TEXT,

    CONSTRAINT "SecureTokenJti_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "SecureTokenJti_expiresAt_idx" ON "public"."SecureTokenJti"("expiresAt");
