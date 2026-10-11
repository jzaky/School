"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Star, UsersRound } from "lucide-react";
import { createTeamAction, setTeamMembersAction } from "@/server/actions/org";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";

export interface TeamView {
  id: string;
  key: string;
  name: string;
  description: string;
  members: { membershipId: string; name: string; roleName: string; isLead: boolean }[];
}

export interface MemberPick {
  membershipId: string;
  name: string;
  email: string;
  roleName: string;
}

export function CreateTeamDialog({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [key, setKey] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!touched) setKey(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48));
  }, [name, touched]);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires users:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create team
        </Button>
      }
      title="Create a team"
      description="Teams own agents and resources and can be targeted by policies."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="create-team-form" type="submit" variant="primary" loading={pending} disabled={name.trim().length < 2 || key.length < 2}>
            Create
          </Button>
        </>
      }
    >
      <form
        id="create-team-form"
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const r = await createTeamAction({ name, key, description });
          setPending(false);
          if (!r.ok) return setError(r.error);
          toast.success(`Team ${name} created`);
          setOpen(false);
          setName("");
          setDescription("");
          setTouched(false);
          router.refresh();
        }}
      >
        <Field label="Name" htmlFor="team-name">
          <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={80} />
        </Field>
        <Field label="Key" htmlFor="team-key" hint="lowercase, digits, hyphens">
          <Input id="team-key" value={key} onChange={(e) => { setTouched(true); setKey(e.target.value); }} className="font-mono" pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$" required />
        </Field>
        <Field label="Description" htmlFor="team-desc">
          <Textarea id="team-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </Field>
        <FormError error={error} />
      </form>
    </Dialog>
  );
}

export function TeamCard({ team, members, canWrite }: { team: TeamView; members: MemberPick[]; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set(team.members.map((m) => m.membershipId)));
  const [lead, setLead] = React.useState<string | null>(team.members.find((m) => m.isLead)?.membershipId ?? null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setSelected(new Set(team.members.map((m) => m.membershipId)));
      setLead(team.members.find((m) => m.isLead)?.membershipId ?? null);
      setError(null);
      setFilter("");
    }
  }, [open, team.members]);
  const visible = members.filter((m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()) || m.email.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {team.name}
          <span className="font-mono text-[11px] font-normal text-fg-dim">{team.key}</span>
        </span>
      }
      description={team.description || undefined}
      actions={
        <Sheet
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button size="sm" disabled={!canWrite} disabledReason="Requires users:write">
              Manage members
            </Button>
          }
          title={`${team.name}: members`}
          description="Tick the members of this team and choose a lead."
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} onClick={async () => {
                setPending(true);
                setError(null);
                const r = await setTeamMembersAction(team.id, [...selected], lead);
                setPending(false);
                if (!r.ok) return setError(r.error);
                toast.success(`${team.name}: ${selected.size} member${selected.size === 1 ? "" : "s"}`);
                setOpen(false);
                router.refresh();
              }}>
                Save members
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input aria-label="Filter members" placeholder="Filter by name or email" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="rounded-md border border-line">
              {visible.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-fg-dim">No members match</p>
              ) : (
                visible.map((m) => {
                  const checked = selected.has(m.membershipId);
                  return (
                    <div key={m.membershipId} className="flex items-center justify-between border-b border-line pe-2 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(m.membershipId);
                              else {
                                next.delete(m.membershipId);
                                if (lead === m.membershipId) setLead(null);
                              }
                              return next;
                            });
                          }}
                          label={m.name}
                          description={`${m.email} · ${m.roleName}`}
                        />
                      </div>
                      <Button size="sm" variant={lead === m.membershipId ? "secondary" : "ghost"} disabled={!checked} disabledReason="Select the member first" aria-pressed={lead === m.membershipId} onClick={() => setLead(lead === m.membershipId ? null : m.membershipId)}>
                        <Star className={`h-3.5 w-3.5 ${lead === m.membershipId ? "text-approval" : ""}`} aria-hidden />
                        {lead === m.membershipId ? "Lead" : "Make lead"}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
            <FormError error={error} />
          </div>
        </Sheet>
      }
      padded={false}
    >
      {team.members.length === 0 ? (
        <EmptyState icon={UsersRound} title="No members yet" className="py-6" />
      ) : (
        <ul className="divide-y divide-line">
          {team.members.map((m) => (
            <li key={m.membershipId} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="flex items-center gap-2">
                {m.name}
                {m.isLead ? <Badge tone="approval">Lead</Badge> : null}
              </span>
              <span className="text-xs text-fg-muted">{m.roleName}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
