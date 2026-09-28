"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Single-series trend (area). Mirrors the time axis in right-to-left layouts. */
export function TrendChart({ data, dir, unit, height = 220 }: { data: Array<{ label: string; value: number }>; dir: "ltr" | "rtl"; unit?: string; height?: number }) {
  const rtl = dir === "rtl";
  return (
    <div style={{ height }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: rtl ? 0 : 8, left: rtl ? 8 : 0, bottom: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" reversed={rtl} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis orientation={rtl ? "right" : "left"} width={32} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: "var(--ring)", strokeWidth: 1 }}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, direction: dir }}
            formatter={(v: number) => [`${v}${unit ?? ""}`, ""]}
            separator=""
          />
          <Area isAnimationActive={false} type="monotone" dataKey="value" stroke="var(--brand)" strokeWidth={2} fill="url(#trendFill)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
