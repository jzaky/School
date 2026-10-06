"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { API_AREAS, ACCESS_LEVELS, scopesFromChoice, type AccessLevel, type ApiArea } from "@/lib/integrations/scopes";
import { createApiKeyAction, revokeApiKeyAction } from "@/server/integrations/actions";

function useError() {
  const t = useTranslations("integrations");
  return (code: string) => (t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

/** A read-only value with a copy button (keys, URLs, code). */
export function CopyValue({ value, testId, mono = true }: { value: string; testId?: string; mono?: boolean }) {
  const t = useTranslations("integrations");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("copyFailed"));
    }
  };
  return (
    <div className="flex min-w-0 gap-2">
      <Input readOnly value={value} dir="ltr" className={mono ? "min-w-0 font-mono text-xs" : "min-w-0 text-xs"} onFocus={(e) => e.currentTarget.select()} data-testid={testId} />
      <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copy} aria-label={t("copy")}>
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

/** A code example with a copy button. Code is always left to right. */
export function CodeBlock({ code, testId }: { code: string; testId?: string }) {
  const t = useTranslations("integrations");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("copyFailed"));
    }
  };
  return (
    <div className="relative min-w-0 rounded-lg border bg-muted/40" data-testid={testId}>
      <Button type="button" variant="ghost" size="icon" className="absolute end-1 top-1 size-7" onClick={copy} aria-label={t("copy")}>
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </Button>
      <pre dir="ltr" className="overflow-x-auto p-3 pe-10 text-start font-mono text-[11px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CreateKeyButton({ disabledReason }: { disabledReason?: string | null }) {
  const t = useTranslations("integrations");
  const err = useError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [choice, setChoice] = useState<Record<ApiArea, AccessLevel>>({ students: "write", staff: "write", classes: "write", attendance: "none" });
  const [key, setKey] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scopes = scopesFromChoice(choice);
  const valid = label.trim().length > 0 && label.trim().length <= 80 && scopes.length > 0;
  const reset = () => {
    setLabel("");
    setKey(null);
    setChoice({ students: "write", staff: "write", classes: "write", attendance: "none" });
  };
  const submit = () =>
    start(async () => {
      const res = await createApiKeyAction({ label, scopes });
      if (!res.ok) return void toast.error(err(res.error));
      setKey(res.key);
      router.refresh();
    });
  const button = (
    <Button
      onClick={() => {
        reset();
        setOpen(true);
      }}
      disabled={!!disabledReason}
      data-testid="create-api-key"
    >
      <Plus className="size-4" />
      {t("keys.create")}
    </Button>
  );
  return (
    <>
      {disabledReason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{button}</span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : (setOpen(false), setKey(null)))}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{key ? t("keys.readyTitle") : t("keys.createTitle")}</DialogTitle>
            <DialogDescription>{key ? t("keys.readyBody") : t("keys.createBody")}</DialogDescription>
          </DialogHeader>
          {key ? (
            <div className="space-y-3">
              <CopyValue value={key} testId="new-api-key" />
              <Alert>
                <AlertTriangle className="size-4" />
                <AlertDescription>{t("keys.onceWarning")}</AlertDescription>
              </Alert>
              <DialogFooter>
                <Button onClick={() => (setOpen(false), setKey(null))} data-testid="api-key-done">
                  {t("done")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="key-label">{t("keys.label")}</Label>
                  <Input id="key-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder={t("keys.labelPlaceholder")} data-testid="api-key-label" />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">{t("keys.scopes")}</div>
                  <p className="text-xs text-muted-foreground">{t("keys.scopesBody")}</p>
                  <div className="divide-y rounded-lg border">
                    {API_AREAS.map((area) => (
                      <div key={area} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm">{t(`areas.${area}`)}</div>
                          <div className="text-xs text-muted-foreground">{t(`areas.${area}Body`)}</div>
                        </div>
                        <Select value={choice[area]} onValueChange={(v) => setChoice((c) => ({ ...c, [area]: v as AccessLevel }))}>
                          <SelectTrigger className="w-40" data-testid={`scope-${area}`} aria-label={t(`areas.${area}`)}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACCESS_LEVELS.map((l) => (
                              <SelectItem key={l} value={l}>
                                {t(`levels.${l}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  {scopes.length === 0 && <p className="text-xs text-danger">{t("error.SCOPES")}</p>}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button onClick={submit} disabled={pending || !valid} data-testid="api-key-save">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  {t("keys.createConfirm")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RevokeKeyButton({ id, label }: { id: string; label: string }) {
  const t = useTranslations("integrations");
  const err = useError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const revoke = () =>
    start(async () => {
      const res = await revokeApiKeyAction(id);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("keys.revoked"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setOpen(true)} data-testid="revoke-api-key">
        <Trash2 className="size-4" />
        {t("keys.revoke")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("keys.revokeTitle", { label })}</DialogTitle>
            <DialogDescription>{t("keys.revokeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={revoke} disabled={pending} data-testid="revoke-api-key-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("keys.revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
