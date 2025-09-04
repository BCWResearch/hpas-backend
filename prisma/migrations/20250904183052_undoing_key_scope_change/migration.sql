-- AlterTable
ALTER TABLE "public"."ApiKeyScope" ALTER COLUMN "scope" SET NOT NULL,
ALTER COLUMN "scope" SET DATA TYPE TEXT;
