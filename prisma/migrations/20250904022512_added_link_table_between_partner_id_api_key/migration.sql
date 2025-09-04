-- CreateTable
CREATE TABLE "public"."ApiKeyAccount" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "partnerAccountId" TEXT NOT NULL,

    CONSTRAINT "ApiKeyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiKeyAccount_apiKeyId_idx" ON "public"."ApiKeyAccount"("apiKeyId");

-- CreateIndex
CREATE INDEX "ApiKeyAccount_partnerAccountId_idx" ON "public"."ApiKeyAccount"("partnerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyAccount_apiKeyId_partnerAccountId_key" ON "public"."ApiKeyAccount"("apiKeyId", "partnerAccountId");

-- AddForeignKey
ALTER TABLE "public"."ApiKeyAccount" ADD CONSTRAINT "ApiKeyAccount_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "public"."ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiKeyAccount" ADD CONSTRAINT "ApiKeyAccount_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "public"."PartnerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
