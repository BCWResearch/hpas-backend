/*
  Warnings:

  - The primary key for the `ApiAdminSession` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `jwt` on the `ApiAdminSession` table. All the data in the column will be lost.
  - Added the required column `jti` to the `ApiAdminSession` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."ApiAdminSession" DROP CONSTRAINT "ApiAdminSession_pkey",
DROP COLUMN "jwt",
ADD COLUMN     "jti" TEXT NOT NULL,
ADD CONSTRAINT "ApiAdminSession_pkey" PRIMARY KEY ("jti");
