/*
  Warnings:

  - Added the required column `status` to the `ApiPartnerUser` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."PartnerUserStatus" AS ENUM ('ACTIVE', 'INVITED', 'PAUSED');

-- AlterTable
ALTER TABLE "public"."ApiPartnerUser" ADD COLUMN     "status" "public"."PartnerUserStatus" NOT NULL;
