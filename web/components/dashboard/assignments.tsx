"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AssignmentsResponse } from "@/app/api/dashboard/nhs-suivi/assignments/route";

// Shared, load-once feed of NHS coordinators + current assignments, so the
// reusable <AssignMenu> can be dropped next to any patient name without each
// instance fetching its own data. One provider wraps the whole NHS tab.

export const COORDINATOR_TONES: Record<string, string> = {
  Summer: "#f59e0b",
  Rain: "#3b82f6",
  Stormi: "#8b5cf6",
};

export function coordinatorTone(name: string | null | undefined): string {
  if (!name) return "var(--accent)";
  return COORDINATOR_TONES[name] ?? "var(--accent)";
}

function normName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

type AssignTarget = { leadId?: string | null; name?: string | null; phone?: string | null };

type AssignmentsContextValue = {
  coordinators: string[];
  loading: boolean;
  /** Current coordinator for a patient, matched by lead_id first then name. */
  assigneeOf: (target: AssignTarget) => string | null;
  /** Assign to a coordinator, or pass null to unassign. Refreshes on success. */
  setAssignee: (target: AssignTarget, coordinator: string | null) => Promise<void>;
  refresh: () => Promise<void>;
};

const AssignmentsContext = createContext<AssignmentsContextValue | null>(null);

export function AssignmentsProvider({ children }: { children: React.ReactNode }) {
  const [coordinators, setCoordinators] = useState<string[]>([]);
  const [byLeadId, setByLeadId] = useState<Map<string, string>>(new Map());
  const [byName, setByName] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const r = await fetch("/api/dashboard/nhs-suivi/assignments", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as AssignmentsResponse;
      const lid = new Map<string, string>();
      const nm = new Map<string, string>();
      for (const a of j.assignments) {
        lid.set(a.lead_id, a.coordinator);
        if (a.name) nm.set(normName(a.name), a.coordinator);
      }
      setCoordinators(j.coordinators);
      setByLeadId(lid);
      setByName(nm);
    } catch {
      /* leave previous state */
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const assigneeOf = useCallback(
    (target: AssignTarget): string | null => {
      if (target.leadId && byLeadId.has(target.leadId)) return byLeadId.get(target.leadId)!;
      if (target.name) {
        const hit = byName.get(normName(target.name));
        if (hit) return hit;
      }
      return null;
    },
    [byLeadId, byName],
  );

  const setAssignee = useCallback(
    async (target: AssignTarget, coordinator: string | null) => {
      const payload: Record<string, unknown> = {};
      if (target.leadId) payload.lead_id = target.leadId;
      else if (target.phone) payload.phone = target.phone;
      else if (target.name) payload.name = target.name;
      if (coordinator) {
        payload.assigned_to = coordinator;
        payload.reason = "Assignation manuelle — suivi NHS S2";
      } else {
        payload.unassign = true;
      }
      const r = await fetch("/api/dashboard/nhs-suivi/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<AssignmentsContextValue>(
    () => ({ coordinators, loading, assigneeOf, setAssignee, refresh }),
    [coordinators, loading, assigneeOf, setAssignee, refresh],
  );

  return <AssignmentsContext.Provider value={value}>{children}</AssignmentsContext.Provider>;
}

export function useAssignments(): AssignmentsContextValue {
  const ctx = useContext(AssignmentsContext);
  if (!ctx) {
    // Safe no-op fallback so an <AssignMenu> rendered outside the provider
    // simply shows nothing actionable rather than crashing.
    return {
      coordinators: [],
      loading: false,
      assigneeOf: () => null,
      setAssignee: async () => {},
      refresh: async () => {},
    };
  }
  return ctx;
}
