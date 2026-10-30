"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import QRCode from "qrcode";
import { beginMfaEnrolment, changePassword, confirmMfaEnrolment, disableMfa, notFound, revokeAllSessions, revokeSession, validation } from "@aegis/core";
import { rawPrisma } from "@aegis/db";
import { requireUser } from "@/server/session";
import { act } from "./util";

export async function changePasswordAction(input: unknown) {
  return act(async () => {
    const s = await requireUser();
    const data = z.object({ current: z.string().min(1).max(512), next: z.string().min(1).max(512), confirm: z.string().min(1).max(512) }).parse(input);
    if (data.next !== data.confirm) throw validation("New passwords do not match");
    await changePassword(s.user.id, data.current, data.next);
    // Other sessions are signed out after a password change; this one stays.
    await revokeAllSessions(s.user.id, s.id);
    revalidatePath("/account/security");
  });
}

export async function beginMfaAction() {
  return act(async () => {
    const s = await requireUser();
    const r = await beginMfaEnrolment(s.user.id);
    const qr = await QRCode.toDataURL(r.uri, { margin: 1, width: 180, color: { dark: "#e6ebf5", light: "#0b0f17" } });
    return { secret: r.secret, qr };
  });
}

export async function confirmMfaAction(code: string) {
  return act(async () => {
    const s = await requireUser();
    await confirmMfaEnrolment(s.user.id, z.string().regex(/^\d{6}$/, "six digits").parse(code.replace(/\s/g, "")));
    await rawPrisma().session.update({ where: { id: s.id }, data: { mfaPassed: true } });
    revalidatePath("/account/security");
  });
}

export async function disableMfaAction(code: string) {
  return act(async () => {
    const s = await requireUser();
    await disableMfa(s.user.id, z.string().regex(/^\d{6}$/, "six digits").parse(code.replace(/\s/g, "")));
    revalidatePath("/account/security");
  });
}

export async function revokeSessionAction(sessionId: string) {
  return act(async () => {
    const s = await requireUser();
    const id = z.string().uuid().parse(sessionId);
    const row = await rawPrisma().session.findUnique({ where: { id }, select: { userId: true } });
    if (!row || row.userId !== s.user.id) throw notFound("Session");
    await revokeSession(id);
    revalidatePath("/account/security");
    return { current: id === s.id };
  });
}

export async function signOutEverywhereAction() {
  return act(async () => {
    const s = await requireUser();
    await revokeAllSessions(s.user.id, s.id);
    revalidatePath("/account/security");
  });
}
