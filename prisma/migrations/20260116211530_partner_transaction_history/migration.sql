-- CreateEnum
CREATE TYPE "public"."PartnerDripStatus" AS ENUM ('SUCCESS', 'PENDING', 'FAILED');

-- CreateTable
CREATE TABLE "public"."PartnerTransactionHistory" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "status" "public"."PartnerDripStatus" NOT NULL,
    "sender_account_id" TEXT NOT NULL,
    "recipient_account_id" TEXT NOT NULL,
    "amountTinybar" BIGINT NOT NULL,

    CONSTRAINT "PartnerTransactionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerTransactionHistory_txId_key" ON "public"."PartnerTransactionHistory"("txId");

-- AddForeignKey
ALTER TABLE "public"."PartnerTransactionHistory" ADD CONSTRAINT "PartnerTransactionHistory_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."ApiPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
