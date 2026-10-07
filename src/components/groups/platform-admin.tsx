"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImagePlus, Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill } from "@/components/app/badges";
import { GroupMark } from "@/components/groups/group-mark";
import { assignSchoolAction, createGroupAction, removeMemberAction, removeSchoolAction, setMemberAction, updateGroupAction, uploadGroupLogoAction } from "@/server/groups/actions";

type Res = { ok: true } | { ok: false; error: string };

function useRun() {
  const t = useTranslations("groups");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(t("saved"));
        after?.();
        router.refresh();
      } else toast.error(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
    });
  return { pending, run };
}

export function CreateGroupForm() {
  const t = useTranslations("groups.platform");
  const { pending, run } = useRun();
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createGroupAction({ nameEn, nameAr }), () => {
          setNameEn("");
          setNameAr("");
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="g-name-en">{t("nameEn")}</Label>
        <Input id="g-name-en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} data-testid="platform-group-name-en" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="g-name-ar">{t("nameAr")}</Label>
        <Input id="g-name-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} data-testid="platform-group-name-ar" />
      </div>
      <Button type="submit" disabled={pending || nameEn.trim().length < 2 || nameAr.trim().length < 2} data-testid="platform-group-create">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {t("create")}
      </Button>
    </form>
  );
}

export type PlatformGroup = {
  id: string;
  nameEn: string;
  nameAr: string;
  displayName: string;
  hasLogo: boolean;
  version: number;
  schools: Array<{ orgId: string; name: string; via: string }>;
  members: Array<{ id: string; name: string; email: string; role: "ADMIN" | "VIEWER" }>;
};

export function GroupAdminCard({ group, ungrouped }: { group: PlatformGroup; ungrouped: Array<{ id: string; name: string }> }) {
  const t = useTranslations("groups.platform");
  const tg = useTranslations("groups");
  const { pending, run } = useRun();
  const [nameEn, setNameEn] = useState(group.nameEn);
  const [nameAr, setNameAr] = useState(group.nameAr);
  const [school, setSchool] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "VIEWER">("VIEWER");
  return (
    <section className="space-y-5 rounded-xl border bg-card p-5 shadow-xs" data-testid={`platform-group-${group.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <GroupMark groupId={group.id} name={group.displayName} hasLogo={group.hasLogo} version={group.version} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{group.displayName}</h2>
          <p className="text-xs text-muted-foreground">{t("counts", { schools: group.schools.length, people: group.members.length })}</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
          <ImagePlus className="size-4" />
          {t("logo")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const fd = new FormData();
              fd.set("groupId", group.id);
              fd.set("file", file);
              run(() => uploadGroupLogoAction(fd));
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`n-en-${group.id}`}>{t("nameEn")}</Label>
          <Input id={`n-en-${group.id}`} dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`n-ar-${group.id}`}>{t("nameAr")}</Label>
          <Input id={`n-ar-${group.id}`} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </div>
        <Button variant="outline" disabled={pending || (nameEn === group.nameEn && nameAr === group.nameAr)} onClick={() => run(() => updateGroupAction({ groupId: group.id, nameEn, nameAr }))}>
          {tg("save")}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t("schools")}</h3>
          <ul className="divide-y rounded-lg border" role="list">
            {group.schools.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">{t("noSchools")}</li>}
            {group.schools.map((s) => (
              <li key={s.orgId} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <Pill tone={s.via === "invite" ? "info" : "neutral"}>{tg(`via.${s.via === "invite" ? "invite" : "platform"}`)}</Pill>
                <Button size="icon" variant="ghost" aria-label={t("removeSchool", { school: s.name })} disabled={pending} onClick={() => run(() => removeSchoolAction({ groupId: group.id, orgId: s.orgId }))}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          {ungrouped.length > 0 ? (
            <div className="flex gap-2">
              <Select value={school} onValueChange={setSchool}>
                <SelectTrigger className="w-full" data-testid={`platform-add-school-${group.id}`}>
                  <SelectValue placeholder={t("chooseSchool")}>{ungrouped.find((u) => u.id === school)?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {ungrouped.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button disabled={!school || pending} onClick={() => run(() => assignSchoolAction({ groupId: group.id, orgId: school }), () => setSchool(""))}>
                {t("addSchool")}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("allAssigned")}</p>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t("people")}</h3>
          <ul className="divide-y rounded-lg border" role="list">
            {group.members.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">{t("noPeople")}</li>}
            {group.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{m.name}</div>
                  <div className="truncate text-xs text-muted-foreground" dir="ltr">
                    {m.email}
                  </div>
                </div>
                <Pill tone={m.role === "ADMIN" ? "brand" : "neutral"}>{tg(`role.${m.role}`)}</Pill>
                <Button size="icon" variant="ghost" aria-label={t("removePerson", { name: m.name })} disabled={pending} onClick={() => run(() => removeMemberAction({ groupId: group.id, memberId: m.id }))}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => setMemberAction({ groupId: group.id, email, role }), () => setEmail(""));
            }}
          >
            <Input type="email" dir="ltr" aria-label={t("email")} value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-0 flex-1" />
            <Select value={role} onValueChange={(v) => setRole(v === "ADMIN" ? "ADMIN" : "VIEWER")}>
              <SelectTrigger className="w-44" aria-label={t("role")}>
                <SelectValue>{tg(`role.${role}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VIEWER">{tg("role.VIEWER")}</SelectItem>
                <SelectItem value="ADMIN">{tg("role.ADMIN")}</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={pending || !email.includes("@")}>
              <UserPlus className="size-4" />
              {t("addPerson")}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">{t("peopleHint")}</p>
        </div>
      </div>
    </section>
  );
}
