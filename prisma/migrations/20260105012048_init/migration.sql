/*
  Warnings:

  - Changed the type of `encryptedPrivateKey` on the `ApiPartner` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "public"."ApiPartner" DROP COLUMN "encryptedPrivateKey",
ADD COLUMN     "encryptedPrivateKey" BYTEA NOT NULL;
