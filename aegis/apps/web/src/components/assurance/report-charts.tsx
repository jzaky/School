"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useThemeTokens, type ThemeTokens } from "@/lib/theme";

function palette(t: ThemeTokens) {
  return {
    COLORS: { allow: t.allow, deny: t.deny, require_approval: t.approval, error: t.critical, info: t.info, neutral: t["fg-dim"] },
    SEVERITY_COLOR: { critical: t.critical, high: t.deny, medium: t.approval, low: t["fg-dim"] } as Record<string, string>,
    tooltipStyle: { background: t["bg-elev-2"], border: `1px solid ${t["line-strong"]}`, borderRadius: 6, fontSize: 12, color: t.fg },
    grid: t.line,
    tick: t["fg-muted"],
    tickDim: t["fg-dim"],
    fg: t.fg,
    cursor: t["bg-elev-2"],
  };
}

export function DecisionsChart({ data }: { data: { day: string; allow: number; deny: number; require_approval: number; error: number }[] }) {
  const { COLORS, tooltipStyle, grid, tick, tickDim, fg } = palette(useThemeTokens());
  const rows = data.map((d) => ({ ...d, label: d.day.slice(5) }));
  return (
    <div className="h-[220px] w-full" role="img" aria-label={`Decisions per day: ${rows.reduce((n, r) => n + r.allow + r.deny + r.require_approval + r.error, 0)} in total`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: tick, fontSize: 11 }} axisLine={{ stroke: grid }} tickLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fill: tickDim, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: fg }} labelStyle={{ color: tick }} />
          <Area type="monotone" dataKey="allow" name="Allowed" stackId="1" stroke={COLORS.allow} fill={COLORS.allow} fillOpacity={0.35} isAnimationActive={false} />
          <Area type="monotone" dataKey="require_approval" name="Approval required" stackId="1" stroke={COLORS.require_approval} fill={COLORS.require_approval} fillOpacity={0.35} isAnimationActive={false} />
          <Area type="monotone" dataKey="deny" name="Denied" stackId="1" stroke={COLORS.deny} fill={COLORS.deny} fillOpacity={0.35} isAnimationActive={false} />
          <Area type="monotone" dataKey="error" name="Evaluation error" stackId="1" stroke={COLORS.error} fill={COLORS.error} fillOpacity={0.35} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AlertsBySeverityChart({ data }: { data: { severity: string; open: number; handled: number }[] }) {
  const { COLORS, SEVERITY_COLOR, tooltipStyle, grid, tick, tickDim, fg, cursor } = palette(useThemeTokens());
  return (
    <div className="h-[200px] w-full" role="img" aria-label={`Alerts by severity: ${data.map((d) => `${d.severity} ${d.open + d.handled}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap={18}>
          <XAxis dataKey="severity" tick={{ fill: tick, fontSize: 11 }} axisLine={{ stroke: grid }} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: tickDim, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip cursor={{ fill: cursor, opacity: 0.6 }} contentStyle={tooltipStyle} itemStyle={{ color: fg }} labelStyle={{ color: tick }} />
          <Bar dataKey="open" name="Open" stackId="a" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.severity} fill={SEVERITY_COLOR[d.severity] ?? COLORS.neutral} />
            ))}
          </Bar>
          <Bar dataKey="handled" name="Acknowledged or resolved" stackId="a" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.severity} fill={SEVERITY_COLOR[d.severity] ?? COLORS.neutral} fillOpacity={0.35} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
