"use server";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { listAgents, listMembers } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

export interface SearchHit {
  id: string;
  label: string;
  hint: string;
  href: string;
}

export async function globalSearchAction(query: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const q = z.string().max(120).parse(query).trim();
    if (q.length < 1) return { agents: [] as SearchHit[], members: [] as SearchHit[] };
    const [agents, members] = await withTenant(c.ctx.orgId, async (db) => {
      const a = c.can("agents:read") ? await listAgents(db, c.ctx, { q, page: 1, pageSize: 8 }) : null;
      const m = c.can("users:read") ? await listMembers(db, c.ctx) : [];
      return [a, m] as const;
    });
    const lq = q.toLowerCase();
    return {
      agents: (agents?.items ?? []).map((a) => ({ id: a.id, label: a.name, hint: a.slug, href: `/agents/${a.id}` })),
      members: members
        .filter((m) => m.user && (m.user.name.toLowerCase().includes(lq) || m.user.email.toLowerCase().includes(lq)))
        .slice(0, 8)
        .map((m) => ({ id: m.id, label: m.user!.name, hint: m.role.name, href: `/org/users?q=${encodeURIComponent(m.user!.name)}` })),
    };
  });
}
