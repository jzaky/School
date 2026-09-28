import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { appointmentWhere } from "@/server/appointments/queries";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[,;\\]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");

/** Calendar file so the meeting lands in Outlook, Google or Apple calendars. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const a = await ctx.db.appointment.findFirst({ where: { AND: [{ id }, appointmentWhere(ctx)] }, include: { type: true } });
  if (!a) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const title = ctx.locale === "ar" ? a.type.nameAr : a.type.nameEn;
  const location = (ctx.locale === "ar" ? a.locationAr : a.locationEn) ?? "";
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Horizon OS//Meetings//EN",
    "BEGIN:VEVENT",
    `UID:${a.id}@horizon-os`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(a.startsAt)}`,
    `DTEND:${stamp(a.endsAt)}`,
    `SUMMARY:${esc(title)}`,
    `LOCATION:${esc(location)}`,
    `STATUS:${a.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT60M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return new NextResponse(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="meeting-${a.id}.ics"` } });
}
