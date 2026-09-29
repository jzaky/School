// Pure pathway engine. Safe to import from client components and from the server.
// Server-side loading, caching, access and plans live in service.ts (server only).
export * from "./types";
export * from "./grade-scales";
export { applicableRows, evaluate, evaluateAll, statusCounts, statusFrom, APPLICATION_STEPS, TEST_ALTERNATIVES } from "./evaluate";
export { applyChanges, diffResults, plannedCourse, whatIf, type WhatIfChange, type ProgramDelta, type LineChange } from "./whatif";
export { rankUnlocks, earliestGrade, UNLOCK_WEIGHTS, type UnlockResult } from "./unlock";
export { planCourses, findTargetPrograms, aggregateNeeds, CORE_SUBJECTS, type PlannerProgram, type PlannerOutput, type PlanItemOut, type SubjectNeed, type Goal, type CareerFieldWeight } from "./planner";
export { COURSE_PREREQUISITES, prerequisitesOf } from "./prereqs";
export { stableStringify, hashString } from "./hash";
