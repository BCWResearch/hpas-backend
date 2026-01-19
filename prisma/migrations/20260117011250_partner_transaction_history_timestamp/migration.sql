-- AlterTable
ALTER TABLE "public"."PartnerTransactionHistory" ADD COLUMN     "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
