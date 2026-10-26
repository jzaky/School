-- Subject offerings: one row per subject, grade and track, so two tracks can both offer a subject in the
-- same grade (for example Arabic for the American and the British track next year). A null track means
-- every track; NULLS NOT DISTINCT keeps a second "every track" row for the same subject and grade out.

-- DropIndex
DROP INDEX "SubjectOffering_orgId_academicYearId_subjectId_gradeLevel_key";

-- CreateIndex
CREATE UNIQUE INDEX "SubjectOffering_orgId_academicYearId_subjectId_gradeLevel_c_key" ON "SubjectOffering"("orgId", "academicYearId", "subjectId", "gradeLevel", "curriculum") NULLS NOT DISTINCT;
