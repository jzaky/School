import { StudentPathwayPage, engineMetadata } from "@/components/pathway-engine/pages";

export const generateMetadata = engineMetadata;

export default async function Page({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <StudentPathwayPage tab="overview" studentId={studentId} />;
}
