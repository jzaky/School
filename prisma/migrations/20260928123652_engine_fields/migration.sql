-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "output" "DocumentOutput",
ADD COLUMN     "renderData" JSONB;

-- AlterTable
ALTER TABLE "StaffProfile" ADD COLUMN     "gradeLevels" INTEGER[];

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "href" TEXT;
