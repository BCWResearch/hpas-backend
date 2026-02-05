-- CreateTable
CREATE TABLE "public"."ApiAdminSession" (
    "jwt" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiAdminSession_pkey" PRIMARY KEY ("jwt")
);

-- CreateIndex
CREATE INDEX "ApiAdminSession_adminId_idx" ON "public"."ApiAdminSession"("adminId");

-- CreateIndex
CREATE INDEX "ApiAdminSession_expiresAt_idx" ON "public"."ApiAdminSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."ApiAdminSession" ADD CONSTRAINT "ApiAdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "public"."ApiPartnerAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
