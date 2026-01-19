/*
  Warnings:

  - A unique constraint covering the columns `[accountId,nonce]` on the table `ApiUserLoginNonce` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ApiUserLoginNonce_accountId_nonce_key" ON "public"."ApiUserLoginNonce"("accountId", "nonce");
