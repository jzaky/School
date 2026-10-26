// What a helper may see while choosing for a student. Assisted access covers course selection only: the
// picker's university guidance (pathways.view) for that one student, and no other permission, student or
// record (cases, wellbeing and medical data stay behind their own access rules).
import type { EngineActor } from "@/server/pathway-engine/access";

export function helperEngineActor(base: EngineActor, studentId: string): EngineActor {
  return { ...base, can: (p) => p === "pathways.view" || base.can(p), visibleStudentIds: [studentId] };
}
