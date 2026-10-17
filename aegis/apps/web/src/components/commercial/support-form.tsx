"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSupportRequestAction } from "@/server/actions/commercial";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";

export function SupportRequestForm() {
  const router = useRouter();
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [severity, setSeverity] = React.useState("normal");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      data-testid="support-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await createSupportRequestAction({ subject, body, severity });
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("Support request sent");
        setSubject("");
        setBody("");
        setSeverity("normal");
        router.refresh();
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Subject" htmlFor="sr-subject" className="md:col-span-2">
          <Input id="sr-subject" value={subject} onChange={(e) => setSubject(e.target.value)} minLength={4} maxLength={160} required />
        </Field>
        <Field label="Severity" htmlFor="sr-severity">
          <NativeSelect id="sr-severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="low">Low: a question</option>
            <option value="normal">Normal</option>
            <option value="high">High: a feature is not working</option>
            <option value="urgent">Urgent: agents are blocked or unsafe</option>
          </NativeSelect>
        </Field>
      </div>
      <Field label="What happened" htmlFor="sr-body" hint="Do not paste personal data or secrets; link to the request or agent in AEGIS instead">
        <Textarea id="sr-body" value={body} onChange={(e) => setBody(e.target.value)} minLength={10} maxLength={5000} rows={5} required />
      </Field>
      <FormError error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending}>
          Send to support
        </Button>
      </div>
    </form>
  );
}
