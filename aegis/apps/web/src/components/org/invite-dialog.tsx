"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { inviteUserAction } from "@/server/actions/org";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CodeBlock } from "@/components/ui/code-block";
import { formatDateTime } from "@/lib/utils";

export function InviteDialog({ roles, canWrite }: { roles: { id: string; name: string; key: string }[]; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [roleId, setRoleId] = React.useState(roles.find((r) => r.key === "viewer")?.id ?? roles[0]?.id ?? "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ link: string; expiresAt: string } | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setResult(null);
          setError(null);
          setEmail("");
        }
      }}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires users:write">
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
          Invite member
        </Button>
      }
      title={result ? "Invitation link" : "Invite a member"}
      description={result ? "Send this link to the invitee. It is shown once and expires in 7 days." : "The person you invite accepts by signing in with this same email address."}
      footer={
        result ? (
          <Button variant="primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button form="invite-form" type="submit" variant="primary" loading={pending} disabled={!email || !roleId}>
              Create invitation
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2">
          <CodeBlock code={result.link} wrap label="Invitation link" />
          <p className="text-xs text-fg-muted">Expires {formatDateTime(result.expiresAt)}. This deployment does not send the email for you, so copy the link and send it yourself.</p>
        </div>
      ) : (
        <form
          id="invite-form"
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            const r = await inviteUserAction({ email, roleId });
            setPending(false);
            if (!r.ok) return setError(r.error);
            setResult(r.data);
            router.refresh();
          }}
        >
          <Field label="Email" htmlFor="invite-email">
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="person@company.example" />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" value={roleId} onValueChange={setRoleId} options={roles.map((r) => ({ value: r.id, label: r.name }))} />
          </Field>
          <FormError error={error} />
        </form>
      )}
    </Dialog>
  );
}
