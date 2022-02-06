-- AlterTable
ALTER TABLE "User" ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");

-- RenameIndex
ALTER INDEX "User.slackID_unique" RENAME TO "User_slackID_key";
