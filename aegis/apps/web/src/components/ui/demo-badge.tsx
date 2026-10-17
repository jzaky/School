import { FlaskConical } from "lucide-react";
import { Badge } from "./badge";

export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Badge tone="approval" className="gap-1">
      <FlaskConical className="h-3 w-3" aria-hidden />
      Demo data
    </Badge>
  );
}
