import Link from "next/link";
import { Logo } from "@/components/marketing/logo";

export default function Landing() {
  return (
    <div className="p-10">
      <Logo />
      <Link href="/demo">demo</Link>
    </div>
  );
}
