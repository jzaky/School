import { StaticPathwayPage, engineMetadata } from "@/components/pathway-engine/pages";

export const generateMetadata = engineMetadata;

export default async function Page({ searchParams }: { searchParams: Promise<{ student?: string; q?: string; tab?: string }> }) {
  return <StaticPathwayPage tab="whatIf" sp={await searchParams} />;
}
