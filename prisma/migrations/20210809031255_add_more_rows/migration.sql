/*
  Warnings:

  - Added the required column `currentSong` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentSong" TEXT NOT NULL,
ADD COLUMN     "playing" BOOLEAN NOT NULL DEFAULT false;
