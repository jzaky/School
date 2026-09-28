"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Draw a signature with a finger, pen or mouse. The value is a PNG data URL. */
export function SignaturePad({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const t = useTranslations("forms");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#123a63";
    if (value?.startsWith("data:image")) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.offsetWidth, c.offsetHeight);
      img.src = value;
    }
    // Initial paint only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        className="h-32 w-full touch-none rounded-lg border bg-white"
        aria-label={t("signHere")}
        onPointerDown={(e) => {
          if (disabled) return;
          drawing.current = true;
          const ctx = canvas.current!.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          canvas.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          onChange(canvas.current!.toDataURL("image/png"));
        }}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("signHere")}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={disabled}
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            onChange("");
          }}
        >
          <Eraser className="size-3.5" />
          {t("clear")}
        </Button>
      </div>
    </div>
  );
}
