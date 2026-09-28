"use client";

import {
  BarChart3,
  Blocks,
  Building2,
  Calendar,
  CalendarClock,
  CheckSquare,
  Compass,
  Contact,
  FileSignature,
  FileText,
  FolderKanban,
  GraduationCap,
  Home,
  Inbox,
  LayoutGrid,
  ListChecks,
  Scale,
  ScrollText,
  Shield,
  Stamp,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";

const STATIC: Record<string, LucideIcon> = {
  "bar-chart-3": BarChart3,
  blocks: Blocks,
  "building-2": Building2,
  calendar: Calendar,
  "calendar-clock": CalendarClock,
  "check-square": CheckSquare,
  compass: Compass,
  contact: Contact,
  "file-signature": FileSignature,
  "file-text": FileText,
  "folder-kanban": FolderKanban,
  "graduation-cap": GraduationCap,
  home: Home,
  inbox: Inbox,
  "layout-grid": LayoutGrid,
  "list-checks": ListChecks,
  scale: Scale,
  "scroll-text": ScrollText,
  shield: Shield,
  stamp: Stamp,
  users: Users,
  workflow: Workflow,
};

/** Icon by kebab-case lucide name. Common icons are bundled; others load on demand. */
export function Icon({ name, className }: { name: string; className?: string }) {
  const Static = STATIC[name];
  if (Static) return <Static className={className} aria-hidden />;
  return <DynamicIcon name={name as IconName} className={className} aria-hidden fallback={() => <span className={className} />} />;
}
