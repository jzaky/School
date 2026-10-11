"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = { allow: "#2fbf71", deny: "#e5484d", require_approval: "#f5a524", error: "#c43a7e", info: "#5b8def", neutral: "#5f6d87" };
const SEVERITY_COLOR: Record<string, string> = { critical: "#c43a7e", high: "#e5484d", medium: "#f5a524", low: "#5f6d87" };
const tooltipStyle = { background: "#182236", border: "1px solid #2f4166", borderRadius: 6, fontSize: 12, color: "#e6ebf5" };

export function DecisionsChart({ data }: { data: { day: string; allow: number; deny: number; require_approval: number; error: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: d.day.slice(5) }));
  return (
    <div className="h-[220px] w-full" role="img" aria-label={`Decisions per day: ${rows.reduce((n, r) => n + r.allow + r.deny + r.require_approval + r.error, 0)} in total`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#223049" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#93a1ba", fontSize: 11 }} axisLine={{ stroke: "#223049" }} tickLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fill: "#5f6d87", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#e6ebf5" }} labelStyle={{ color: "#93a1ba" }} />
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
  return (
    <div className="h-[200px] w-full" role="img" aria-label={`Alerts by severity: ${data.map((d) => `${d.severity} ${d.open + d.handled}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap={18}>
          <XAxis dataKey="severity" tick={{ fill: "#93a1ba", fontSize: 11 }} axisLine={{ stroke: "#223049" }} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: "#5f6d87", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip cursor={{ fill: "#182236", opacity: 0.6 }} contentStyle={tooltipStyle} itemStyle={{ color: "#e6ebf5" }} labelStyle={{ color: "#93a1ba" }} />
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
