-- AlterTable
ALTER TABLE "AdditionalRequirement" ADD COLUMN     "evidenceQuote" TEXT;

-- AlterTable
ALTER TABLE "LanguageRequirement" ADD COLUMN     "evidenceQuote" TEXT;

-- AlterTable
ALTER TABLE "ProgramRequirement" ADD COLUMN     "evidenceLocator" TEXT;

-- AlterTable
ALTER TABLE "SubjectRequirement" ADD COLUMN     "evidenceQuote" TEXT;

-- AlterTable
ALTER TABLE "TestRequirement" ADD COLUMN     "evidenceQuote" TEXT;
