-- Subject offerings: the track they are for, the curriculum course they count as for universities,
-- and an Advanced Placement flag.
ALTER TABLE "SubjectOffering" ADD COLUMN "curriculum" "SchoolCurriculum";
ALTER TABLE "SubjectOffering" ADD COLUMN "courseId" TEXT;
ALTER TABLE "SubjectOffering" ADD COLUMN "isAP" BOOLEAN NOT NULL DEFAULT false;
