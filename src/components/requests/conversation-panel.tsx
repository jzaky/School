// The conversation on a request: messages the viewer may read, each labelled with who can see it, and a
// composer. Loaded through src/server/requests/conversation.ts, which applies every access rule.
import { getTranslations } from "next-intl/server";
import { BellRing, EyeOff, Lock, MessagesSquare, Users } from "lucide-react";
import type { MessageVisibility } from "@prisma/client";
import type { Ctx } from "@/server/context";
import type { FormatPrefs } from "@/lib/format";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { initials, pick } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/app/panel";
import { handlingTeam, loadThread, type ThreadPerson } from "@/server/requests/conversation";
import { ConversationComposer } from "./conversation-composer";

export const VIS_STYLE: Record<MessageVisibility, { card: string; chip: string; avatar: string }> = {
  SHARED: { card: "border-border bg-card", chip: "bg-info-soft text-info ring-info/20", avatar: "bg-info-soft text-info" },
  STAFF: { card: "border-dashed border-warning/50 bg-warning-soft/35", chip: "bg-warning-soft text-[oklch(0.5_0.13_65)] ring-warning/30", avatar: "bg-warning-soft text-[oklch(0.5_0.13_65)]" },
  PRIVATE: { card: "border-violet-200 bg-violet-50/60", chip: "bg-violet-50 text-violet-700 ring-violet-200", avatar: "bg-violet-100 text-violet-700" },
};

const VIS_ICON: Record<MessageVisibility, React.ComponentType<{ className?: string }>> = { SHARED: Users, STAFF: EyeOff, PRIVATE: Lock };

export async function ConversationPanel({ ctx, prefs, requestId }: { ctx: Ctx; prefs: FormatPrefs; requestId: string }) {
  const thread = await loadThread(ctx, requestId);
  if (!thread) return null;
  const t = await getTranslations("conversation");
  const { locale } = ctx;
  const { access, messages, people, lastReadAt } = thread;
  const staff = ctx.isStaff;
  const nameOf = (p?: ThreadPerson) => (p ? pick(locale, p.nameEn, p.nameAr) : "");
  const titleOf = (p?: ThreadPerson) => (p ? pick(locale, p.titleEn, p.titleAr) : "");
  const team = staff ? await handlingTeam(ctx.db, access) : [];
  const me = ctx.membershipId;
  const firstUnread = messages.find((m) => m.authorId !== me && (!lastReadAt || m.createdAt > lastReadAt));
  const sharedLabel = access.audience === "family" ? t("vis.SHARED") : t("vis.SHARED_REQUESTER");

  // Family members on this request (for the "who can see this" hint), from the shared messages' authors and the request.
  const familyNames = staff ? await familyLabels(ctx, access.request.requesterId, access.request.studentId, access.request.service.audience) : [];

  const chipText = (vis: MessageVisibility, privateTo: string[], authorId: string) => {
    if (vis === "SHARED") return sharedLabel;
    if (vis === "STAFF") return t("vis.STAFF");
    const others = [authorId, ...privateTo].filter((id) => id !== me).map((id) => nameOf(people[id]));
    return others.length ? t("privateWith", { names: others.join(locale === "ar" ? "، " : ", ") }) : t("vis.PRIVATE");
  };

  return (
    <Panel className="p-0" >
      <div id="conversation" className="scroll-mt-24 border-b px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <MessagesSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{t("title")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{staff ? (access.requesterSide ? t("subtitleStaffRequester") : t("subtitleStaff")) : t("subtitleFamily")}</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground" data-testid="message-count">
            {t("count", { n: messages.length })}
          </span>
        </div>
        {staff && !access.requesterSide && (
          <ul className="mt-3 flex flex-wrap gap-1.5 text-[11px]" aria-label={t("legend")} data-testid="visibility-legend">
            {(["SHARED", "STAFF", "PRIVATE"] as const).map((v) => {
              const I = VIS_ICON[v];
              return (
                <li key={v} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ring-inset", VIS_STYLE[v].chip)}>
                  <I className="size-3" />
                  {v === "SHARED" ? sharedLabel : t(`vis.${v}`)}
                  <span className="font-normal opacity-80">· {t(`legendHint.${v}`)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {access.sensitive && staff && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800" data-testid="sensitive-note">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            {access.sharedBlocked ? t("sensitiveProtected") : t("sensitiveNoAuto")}
          </p>
        )}
      </div>

      <div className="px-3 py-4 sm:px-5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center" data-testid="conversation-empty">
            <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
              <MessagesSquare className="size-5" />
            </span>
            <div className="text-sm font-medium">{t("emptyTitle")}</div>
            <p className="max-w-sm text-xs text-muted-foreground">{staff ? t("emptyStaff") : t("emptyFamily")}</p>
          </div>
        ) : (
          <ol className="space-y-3" data-testid="conversation">
            {messages.map((m) => {
              const author = people[m.authorId];
              const mine = m.authorId === me;
              const I = VIS_ICON[m.visibility];
              return (
                <li key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")} data-testid="message" data-visibility={m.visibility}>
                  {firstUnread?.id === m.id && (
                    <div className="mb-2 flex w-full items-center gap-2 text-[11px] font-semibold text-brand" data-testid="unread-divider">
                      <span className="h-px flex-1 bg-brand/30" />
                      {t("newMessages")}
                      <span className="h-px flex-1 bg-brand/30" />
                    </div>
                  )}
                  <article className={cn("w-full max-w-[92%] rounded-xl border p-3 sm:max-w-[80%]", VIS_STYLE[m.visibility].card)}>
                    <header className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold", author?.family ? "bg-gold-soft text-[oklch(0.5_0.1_80)]" : VIS_STYLE[m.visibility].avatar)}>{initials(author?.nameEn ?? "")}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium leading-tight">{mine ? t("you") : nameOf(author)}</span>
                        <span className="block truncate text-[11px] leading-tight text-muted-foreground">{titleOf(author)}</span>
                      </span>
                      <time className="ms-auto text-[11px] text-muted-foreground" dateTime={m.createdAt.toISOString()} title={fmtDateTime(prefs, m.createdAt)}>
                        {fmtRelative(prefs, m.createdAt)}
                      </time>
                    </header>
                    <p dir="auto" className="whitespace-pre-line text-start text-sm leading-relaxed">{m.body}</p>
                      <footer className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", VIS_STYLE[m.visibility].chip)} data-testid="message-visibility">
                          <I className="size-3 shrink-0" />
                          <span className="truncate">{chipText(m.visibility, m.privateToIds, m.authorId)}</span>
                        </span>
                        {staff && m.familyNotified && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <BellRing className="size-3" />
                            {t("familyNotifiedDecision")}
                          </span>
                        )}
                      </footer>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="border-t bg-muted/20 px-3 py-4 sm:px-5">
        <ConversationComposer
          requestId={requestId}
          staff={staff}
          requesterSide={access.requesterSide}
          audience={access.audience}
          sensitive={access.sensitive}
          sharedBlocked={access.sharedBlocked}
          familyNames={familyNames}
          team={team.filter((p) => p.id !== me).map((p) => ({ id: p.id, name: nameOf(p), title: titleOf(p) }))}
          teamCount={team.filter((p) => p.id !== me).length}
        />
      </div>
    </Panel>
  );
}

/** Names of the family members on the requester side, for the "who can see this" hint. */
async function familyLabels(ctx: Ctx, requesterId: string, studentId: string | null, audience: string[]) {
  const ids = new Set<string>();
  const requester = await ctx.db.membership.findUnique({ where: { id: requesterId }, include: { user: true, roles: { include: { role: true } } } });
  const out: string[] = [];
  if (requester && requester.roles.some((r) => r.role.key === "parent" || r.role.key === "student")) {
    ids.add(requester.id);
    out.push(pick(ctx.locale, requester.user.nameEn, requester.user.nameAr));
  }
  if (studentId && audience.includes("parent")) {
    const links = await ctx.db.guardianLink.findMany({ where: { studentId }, include: { guardian: { include: { membership: { include: { user: true } } } } } });
    for (const l of links) {
      const m = l.guardian.membership;
      if (m && !ids.has(m.id)) {
        ids.add(m.id);
        out.push(pick(ctx.locale, m.user.nameEn, m.user.nameAr));
      }
    }
  }
  return out;
}
