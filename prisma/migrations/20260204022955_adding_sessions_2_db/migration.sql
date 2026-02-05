-- CreateTable
CREATE TABLE "public"."ApiSession" (
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiSession_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "ApiSession_userId_idx" ON "public"."ApiSession"("userId");

-- CreateIndex
CREATE INDEX "ApiSession_partnerId_idx" ON "public"."ApiSession"("partnerId");

-- CreateIndex
CREATE INDEX "ApiSession_expiresAt_idx" ON "public"."ApiSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."ApiSession" ADD CONSTRAINT "ApiSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."ApiPartnerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
