/*
  Warnings:

  - A unique constraint covering the columns `[nonce]` on the table `ApiUserLoginNonce` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."ApiUserLoginNonce_accountId_nonce_key";

-- CreateIndex
CREATE UNIQUE INDEX "ApiUserLoginNonce_nonce_key" ON "public"."ApiUserLoginNonce"("nonce");
