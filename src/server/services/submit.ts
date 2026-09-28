// Submitting a service: validates the form, stores a Submission, opens a numbered Request and starts its workflow.
import type { ExecCtx } from "@/server/db";
import { nextNumber } from "@/server/common/sequence";
import { notify } from "@/server/notify/notify";
import { pruneHidden, validateValues, type FieldError } from "@/server/forms/logic";
import type { FormSchema } from "@/server/forms/schema";
import { startRun } from "@/server/workflows/engine";
import type { RunContext } from "@/server/workflows/resolve";

export class SubmitError extends Error {
  constructor(
    message: string,
    public fieldErrors: FieldError[] = [],
  ) {
    super(message);
  }
}

export type SubmitInput = {
  serviceId: string;
  requesterId: string;
  studentId?: string | null;
  data: Record<string, unknown>;
  appointmentId?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
};

export async function submitRequest(ec: ExecCtx, input: SubmitInput) {
  const { tx, orgId } = ec;
  const service = await tx.serviceDefinition.findUnique({
    where: { id: input.serviceId },
    include: { form: true, workflow: true },
  });
  if (!service || service.orgId !== orgId || !service.isActive) throw new SubmitError("SERVICE_NOT_FOUND");
  if (service.requiresStudent && !input.studentId) throw new SubmitError("STUDENT_REQUIRED");

  const student = input.studentId ? await tx.student.findUnique({ where: { id: input.studentId } }) : null;
  if (input.studentId && !student) throw new SubmitError("STUDENT_NOT_FOUND");

  let data = input.data;
  let formVersionId: string | null = null;
  if (service.form?.publishedVersionId) {
    const version = await tx.formVersion.findUnique({ where: { id: service.form.publishedVersionId } });
    if (version) {
      const schema = version.schema as unknown as FormSchema;
      data = pruneHidden(schema, data);
      const errors = validateValues(schema, data);
      if (errors.length) throw new SubmitError("VALIDATION", errors);
      formVersionId = version.id;
    }
  }

  const submission = formVersionId
    ? await tx.submission.create({
        data: { orgId, formVersionId, submittedById: input.requesterId, studentId: student?.id ?? null, data: data as never, createdAt: ec.now },
      })
    : null;

  const number = await nextNumber(tx, orgId, service.requestPrefix, ec.now.getFullYear());
  const studentNameEn = student ? `${student.firstNameEn} ${student.lastNameEn}` : "";
  const studentNameAr = student ? `${student.firstNameAr} ${student.lastNameAr}` : "";
  const priority =
    input.priority ??
    (String(data.urgency ?? "") === "high" || String(data.level ?? "") === "HIGH"
      ? "HIGH"
      : String(data.level ?? "") === "IMMEDIATE_DANGER"
        ? "URGENT"
        : "MEDIUM");
  const request = await tx.request.create({
    data: {
      orgId,
      number,
      serviceId: service.id,
      requesterId: input.requesterId,
      studentId: student?.id ?? null,
      submissionId: submission?.id ?? null,
      status: "SUBMITTED",
      priority,
      sensitivity: service.sensitivity,
      titleEn: studentNameEn ? `${service.nameEn} for ${studentNameEn}` : service.nameEn,
      titleAr: studentNameAr ? `${service.nameAr} للطالب/ة ${studentNameAr}` : service.nameAr,
      currentStepEn: "Submitted",
      currentStepAr: "تم التقديم",
      progress: 10,
      slaDueAt: new Date(ec.now.getTime() + service.slaHours * 3600_000),
      submittedAt: ec.now,
      createdAt: ec.now,
    },
  });
  if (input.appointmentId) {
    await tx.appointment.update({ where: { id: input.appointmentId }, data: { requestId: request.id } });
  }
  await tx.timelineEvent.create({
    data: {
      orgId,
      requestId: request.id,
      studentId: student?.id ?? null,
      actorId: input.requesterId,
      kind: "submitted",
      titleEn: "Request submitted",
      titleAr: "تم تقديم الطلب",
      bodyEn: number,
      bodyAr: number,
      sensitivity: service.sensitivity,
      createdAt: ec.now,
    },
  });
  await tx.auditEvent.create({
    data: { orgId, actorId: input.requesterId, action: "request.submit", entityType: "Request", entityId: request.id, sensitivity: service.sensitivity, createdAt: ec.now },
  });
  await notify(ec, {
    recipients: [input.requesterId],
    templateKey: "request_submitted",
    vars: { number, title: { en: request.titleEn, ar: request.titleAr } },
    href: `/requests/${request.id}`,
    channels: ["IN_APP"],
    idempotencyBase: `${request.id}:submitted`,
  });

  let appointmentHostId: string | null = null;
  if (input.appointmentId) {
    const appt = await tx.appointment.findUnique({ where: { id: input.appointmentId } });
    appointmentHostId = appt?.hostId ?? null;
  }

  if (service.workflow?.publishedVersionId) {
    const context: RunContext = {
      form: data,
      request: {
        id: request.id,
        number,
        hasStudent: Boolean(student),
        priority,
        serviceKey: service.key,
        requesterId: input.requesterId,
        sensitivity: service.sensitivity,
      },
      student: student ? { id: student.id, grade: student.gradeLevel, membershipId: student.membershipId } : null,
      appointmentId: input.appointmentId ?? null,
      appointmentHostId,
    };
    await startRun(ec, { workflowVersionId: service.workflow.publishedVersionId, requestId: request.id, context });
  }
  return tx.request.findUniqueOrThrow({ where: { id: request.id } });
}
