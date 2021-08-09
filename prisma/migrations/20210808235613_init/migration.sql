-- CreateTable
CREATE TABLE "User" (
    "slackID" TEXT NOT NULL,
    "slackToken" TEXT NOT NULL,
    "appleMusicToken" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE UNIQUE INDEX "User.slackID_unique" ON "User"("slackID");
