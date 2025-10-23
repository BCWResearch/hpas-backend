-- CreateTable
CREATE TABLE "public"."LockState" (
    "id" VARCHAR(10) NOT NULL DEFAULT 'lock',
    "faucet_paused" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LockState_pkey" PRIMARY KEY ("id")
);
