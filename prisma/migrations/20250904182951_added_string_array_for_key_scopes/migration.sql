/*
  Warnings:

  - The `scope` column on the `ApiKeyScope` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "public"."ApiKeyScope" DROP COLUMN "scope",
ADD COLUMN     "scope" TEXT[];

-- CreateIndex
CREATE INDEX "ApiKeyScope_scope_idx" ON "public"."ApiKeyScope"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyScope_apiKeyId_scope_key" ON "public"."ApiKeyScope"("apiKeyId", "scope");
