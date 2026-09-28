// Workflow graph stored in WorkflowVersion.graph. Shared by the builder (React Flow), the engine and the seed.
import type { I18nText } from "@/server/forms/schema";

export const NODE_TYPES = [
  "start",
  "approval",
  "task",
  "notify",
  "condition",
  "wait",
  "create_case",
  "assign",
  "schedule_meeting",
  "generate_document",
  "update_status",
  "ai_summary",
  "end",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Who a step targets. Resolved at run time against the request, its student and the org. */
export type Assignee =
  | { kind: "role"; role: string }
  | { kind: "member"; membershipId: string }
  | { kind: "persona"; persona: string }
  | { kind: "requester" }
  | { kind: "student" }
  | { kind: "guardians" }
  | { kind: "class_teacher"; subjectField?: string }
  | { kind: "department_head"; subjectField?: string; departmentKey?: string }
  | { kind: "case_assignee" };

export type WorkflowCondition =
  | { field: string; op: "eq" | "neq" | "in" | "gt" | "lt" | "contains" | "empty" | "not_empty"; value?: unknown }
  | { all: WorkflowCondition[] }
  | { any: WorkflowCondition[] };

export type NodeConfig = {
  label: I18nText;
  // approval
  mode?: "SEQUENTIAL" | "PARALLEL_ALL" | "PARALLEL_ANY";
  approvers?: Array<{ assignee: Assignee; label: I18nText; requireSignature?: boolean; when?: WorkflowCondition }>;
  dueInHours?: number;
  // task
  assignee?: Assignee;
  /** When true the run waits until the task is done before moving on. */
  blocking?: boolean;
  title?: I18nText;
  description?: I18nText;
  // notify
  recipients?: Assignee[];
  template?: string;
  message?: I18nText;
  channels?: Array<"IN_APP" | "EMAIL" | "SMS" | "WHATSAPP">;
  // condition
  condition?: WorkflowCondition;
  // wait
  hours?: number;
  // create_case
  caseType?: string;
  sensitivity?: string;
  priority?: string;
  // schedule_meeting
  appointmentTypeKey?: string;
  // generate_document
  templateKey?: string;
  output?: "EN" | "AR" | "BILINGUAL";
  // update_status
  status?: string;
  progress?: number;
  // end
  outcome?: "COMPLETED" | "REJECTED" | "CANCELLED";
};

export type WorkflowNode = {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: NodeConfig;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  /** For condition nodes: "true" or "false". For approval nodes: "approved" or "rejected". */
  sourceHandle?: string | null;
  label?: I18nText;
};

export type WorkflowGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowTemplate = {
  key: string;
  name: I18nText;
  description: I18nText;
  graph: WorkflowGraph;
};
