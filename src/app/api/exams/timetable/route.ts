import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { timetableStudents, publishedSittings } from "@/server/exams/queries";
import { renderExamTimetablePdf } from "@/server/exams/timetable-pdf";

export const runtime = "nodejs";

/** Printable bilingual exam timetable for one grade (students: their own; parents: their children's). */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const students = timetableStudents(ctx);
  let grade: number | null = null;
  let student: { firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string } | null = null;
  if (students) {
    const chosen = students.find((s) => s.id === sp.get("student")) ?? students[0];
    if (!chosen) return NextResponse.json({ error: "not_found" }, { status: 404 });
    grade = chosen.gradeLevel;
    student = chosen;
  } else {
    if (!ctx.isStaff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    grade = Number(sp.get("grade"));
    if (!Number.isInteger(grade) || grade < 1 || grade > 13) return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const sittings = await publishedSittings(ctx, grade);
  const who = student ? { en: `${student.firstNameEn} ${student.lastNameEn}, Grade ${grade}`, ar: `${student.firstNameAr} ${student.lastNameAr}، الصف ${grade}` } : { en: `Grade ${grade}`, ar: `الصف ${grade}` };
  const pdf = await renderExamTimetablePdf({
    school: { en: ctx.org.nameEn, ar: ctx.org.nameAr },
    heading: { en: "Exam timetable", ar: "جدول الامتحانات" },
    subheading: who,
    rows: sittings.map((s) => ({ start: s.startsAt, end: s.endsAt, subjectEn: s.titleEn, subjectAr: s.titleAr, room: s.room })),
    generatedAt: new Date(),
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="exam-timetable-grade-${grade}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
