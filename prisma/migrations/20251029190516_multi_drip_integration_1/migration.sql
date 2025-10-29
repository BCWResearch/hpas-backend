/*
  Warnings:

  - You are about to drop the column `multiDrip` on the `PartnerAccount` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Partner" ADD COLUMN     "multiDrip" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."PartnerAccount" DROP COLUMN "multiDrip";
