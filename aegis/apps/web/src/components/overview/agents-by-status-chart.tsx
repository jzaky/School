"use client";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { statusLabel, statusTone } from "@/lib/status";

const TONE_HEX: Record<string, string> = { allow: "#2fbf71", deny: "#e5484d", approval: "#f5a524", info: "#5b8def", critical: "#c43a7e", neutral: "#5f6d87" };

export function AgentsByStatusChart({ data }: { data: { status: string; count: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: statusLabel(d.status), fill: TONE_HEX[statusTone(d.status)] ?? TONE_HEX.neutral }));
  return (
    <div className="h-[220px] w-full" role="img" aria-label={`Agents by status: ${rows.map((r) => `${r.label} ${r.count}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap={18}>
          <XAxis dataKey="label" tick={{ fill: "#93a1ba", fontSize: 11 }} axisLine={{ stroke: "#223049" }} tickLine={false} interval={0} />
          <YAxis allowDecimals={false} tick={{ fill: "#5f6d87", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip cursor={{ fill: "#182236", opacity: 0.6 }} contentStyle={{ background: "#182236", border: "1px solid #2f4166", borderRadius: 6, fontSize: 12, color: "#e6ebf5" }} itemStyle={{ color: "#e6ebf5" }} labelStyle={{ color: "#93a1ba" }} formatter={(v) => [v as number, "Agents"]} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} label={{ position: "top", fill: "#93a1ba", fontSize: 11 }}>
            {rows.map((r) => (
              <Cell key={r.status} fill={r.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
