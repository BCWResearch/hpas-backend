/*
  Warnings:

  - Added the required column `kmsKeyId` to the `ApiKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `secretCiphertext` to the `ApiKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `secretIv` to the `ApiKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `secretTag` to the `ApiKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `wrappedDek` to the `ApiKey` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."ApiKey" ADD COLUMN     "kmsKeyId" TEXT NOT NULL,
ADD COLUMN     "lastRevealedAt" TIMESTAMP(3),
ADD COLUMN     "revealedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "secretCiphertext" BYTEA NOT NULL,
ADD COLUMN     "secretIv" BYTEA NOT NULL,
ADD COLUMN     "secretTag" BYTEA NOT NULL,
ADD COLUMN     "wrappedDek" BYTEA NOT NULL;
