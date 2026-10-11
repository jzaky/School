"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, FilePenLine, Plus, Power, Send, XCircle } from "lucide-react";
import { activateVersionAction, createVersionAction, deactivatePolicyAction, submitForReviewAction, type PolicyTestResult } from "@/server/actions/policies";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormError, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";

export interface SelectedVersion {
  id: string;
  version: number;
  state: string;
  createdBy: string | null;
  document: unknown;
}

export function PolicyActions({ policyId, policyName, version, activeVersionId, userId, canWrite, canActivate, fourEyes }: { policyId: string; policyName: string; version: SelectedVersion | null; activeVersionId: string | null; userId: string; canWrite: boolean; canActivate: boolean; fourEyes: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [tests, setTests] = React.useState<{ results: PolicyTestResult[]; error: string | null } | null>(null);
  const [deactivate, setDeactivate] = React.useState(false);
  const [activate, setActivate] = React.useState(false);
  const [newVersion, setNewVersion] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [nvError, setNvError] = React.useState<string | null>(null);
  if (!version) return null;
  const isAuthor = version.createdBy === userId;
  const fourEyesBlocked = fourEyes && isAuthor;

  async function submitReview() {
    setBusy("submit");
    const r = await submitForReviewAction(policyId, version!.id);
    setBusy(null);
    if (r.ok) {
      setTests({ results: r.data.tests, error: null });
      toast.success(`v${version!.version} submitted for review`);
      router.refresh();
    } else {
      setTests({ results: r.tests ?? [], error: r.error });
    }
  }
  async function createVersion(e: React.FormEvent) {
    e.preventDefault();
    setBusy("new");
    setNvError(null);
    const r = await createVersionAction(policyId, { document: version!.document, changeNote: note });
    setBusy(null);
    if (!r.ok) return setNvError(r.error);
    toast.success(`Draft v${r.data.version} created from v${version!.version}`);
    setNewVersion(false);
    setNote("");
    router.push(`/policies/${policyId}?v=${r.data.versionId}&tab=editor`);
  }

  return (
    <>
      {version.state === "draft" ? (
        <Button variant="secondary" disabled={!canWrite} disabledReason="Requires policies:write" onClick={() => router.push(`/policies/${policyId}?v=${version.id}&tab=editor`)}>
          <FilePenLine className="h-3.5 w-3.5" aria-hidden />
          Edit draft
        </Button>
      ) : null}
      <Button variant="secondary" disabled={!canWrite} disabledReason="Requires policies:write" onClick={() => setNewVersion(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        New version
      </Button>
      {version.state === "draft" ? (
        <Button variant="secondary" loading={busy === "submit"} disabled={!canWrite} disabledReason="Requires policies:write" onClick={submitReview}>
          <Send className="h-3.5 w-3.5" aria-hidden />
          Submit for review
        </Button>
      ) : null}
      {version.state === "review" || version.state === "draft" ? (
        <Button variant="primary" disabled={!canActivate || fourEyesBlocked || version.state === "draft"} disabledReason={!canActivate ? "Requires policies:activate" : fourEyesBlocked ? "Four-eyes: the author cannot activate" : "Submit the draft for review first"} onClick={() => setActivate(true)}>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          Activate v{version.version}
        </Button>
      ) : null}
      {activeVersionId ? (
        <Button variant="danger" disabled={!canActivate} disabledReason="Requires policies:activate" onClick={() => setDeactivate(true)}>
          <Power className="h-3.5 w-3.5" aria-hidden />
          Deactivate
        </Button>
      ) : null}

      <ConfirmDialog
        open={activate}
        onOpenChange={setActivate}
        title={`Activate v${version.version} of ${policyName}`}
        description="The version becomes the one evaluated on every matching request. Any previously active version is retired, not changed. Your activation is recorded as the second pair of eyes."
        confirmLabel="Activate"
        onConfirm={async () => {
          const r = await activateVersionAction(policyId, version.id);
          if (!r.ok) return r.error;
          toast.success(`v${version.version} is now active`);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={deactivate}
        onOpenChange={setDeactivate}
        title={`Deactivate ${policyName}`}
        description="Retires the active version. Requests that relied on this policy for an allow will fall to default deny until another version is activated."
        confirmLabel="Deactivate"
        danger
        reason={{ required: true, placeholder: "Why this policy is being switched off" }}
        onConfirm={async ({ reason }) => {
          const r = await deactivatePolicyAction(policyId, reason);
          if (!r.ok) return r.error;
          toast.success("Policy deactivated");
          router.refresh();
        }}
      />
      <Dialog
        open={newVersion}
        onOpenChange={(o) => {
          setNewVersion(o);
          if (!o) setNvError(null);
        }}
        title="New draft version"
        description={`Copies the document of v${version.version} into a new draft you can edit. Nothing changes until that draft is reviewed and activated.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewVersion(false)} disabled={busy === "new"}>
              Cancel
            </Button>
            <Button form="pa-new-version" type="submit" variant="primary" loading={busy === "new"} disabled={note.trim().length < 2} disabledReason="A change note is required">
              Create draft
            </Button>
          </>
        }
      >
        <form id="pa-new-version" onSubmit={createVersion} className="space-y-3">
          <Field label="Change note" htmlFor="pa-note" hint="required">
            <Textarea id="pa-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus placeholder="What will change in this version" />
          </Field>
          <FormError error={nvError} />
        </form>
      </Dialog>
      <Dialog
        open={tests !== null}
        onOpenChange={(o) => !o && setTests(null)}
        title={tests?.error ? "Submission blocked by embedded tests" : "Embedded tests passed"}
        description={tests?.error ?? "Every embedded test case produced the expected effect. The version is now in review and can be activated by someone other than its author."}
        size="lg"
        footer={
          <Button variant="primary" onClick={() => setTests(null)}>
            Close
          </Button>
        }
      >
        {tests && tests.results.length ? (
          <SimpleTable caption="Embedded test results">
            <thead>
              <tr>
                <Th>Test</Th>
                <Th>Expected</Th>
                <Th>Actual</Th>
                <Th>Deciding rule</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {tests.results.map((t) => (
                <Tr key={t.name}>
                  <Td>{t.name}</Td>
                  <Td>
                    <StatusBadge status={t.expected} />
                  </Td>
                  <Td>
                    <StatusBadge status={t.actual} />
                  </Td>
                  <Td mono>{t.decidingRule ?? "default deny"}</Td>
                  <Td>
                    {t.passed ? (
                      <Badge tone="allow">
                        <CheckCircle2 className="h-3 w-3" aria-hidden /> pass
                      </Badge>
                    ) : (
                      <Badge tone="deny">
                        <XCircle className="h-3 w-3" aria-hidden /> fail
                      </Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </SimpleTable>
        ) : (
          <p className="text-xs text-fg-muted">
            This document has no embedded tests. Add cases under <span className="font-mono">tests</span> so reviewers can see the expected behaviour. <Link href={`/policies/${policyId}?tab=editor`} className="text-accent hover:underline">Open the editor</Link>
          </p>
        )}
      </Dialog>
    </>
  );
}
