/**
 * Permissions come from the user's group (Users → Groups). A group's permissions are a set of
 * module → actions. "delete" never erases a record (the audit trail depends on them): it archives a client,
 * cancels a project / PO / invoice, or deactivates a user.
 */

export type Module = "clients" | "projects" | "pos" | "invoices" | "users" | "reports" | "audit" | "settings";
export type Action = "view" | "create" | "edit" | "delete" | "approve" | "payments" | "email" | "export" | "groups" | "administer";
export type Perms = Partial<Record<Module, Action[]>>;

/** What can be granted, per module, in the order shown on the group editor. Labels override the generic action label. */
export const MODULES: { key: Module; label: string; actions: { key: Action; label?: string; hint?: string }[] }[] = [
  { key: "clients", label: "Clients", actions: [
    { key: "view" }, { key: "create" }, { key: "edit" }, { key: "delete", hint: "Archive" }, { key: "export" },
  ] },
  { key: "projects", label: "Projects", actions: [
    { key: "view" }, { key: "create" }, { key: "edit" }, { key: "delete", hint: "Cancel" }, { key: "approve", hint: "Start / complete" }, { key: "export" },
  ] },
  { key: "pos", label: "Purchase orders", actions: [
    { key: "view" }, { key: "create" }, { key: "edit" }, { key: "delete", hint: "Cancel" }, { key: "approve", hint: "Approve / reject" }, { key: "export" },
  ] },
  { key: "invoices", label: "Invoices", actions: [
    { key: "view" }, { key: "create" }, { key: "edit" }, { key: "delete", hint: "Cancel" }, { key: "approve", label: "Finalize" },
    { key: "payments", label: "Payments", hint: "Record / reverse" }, { key: "email" }, { key: "export" },
  ] },
  { key: "users", label: "Users", actions: [
    { key: "view" }, { key: "create" }, { key: "edit" }, { key: "delete", hint: "Deactivate" }, { key: "groups", label: "Manage groups", hint: "Groups & permissions" },
  ] },
  { key: "reports", label: "Reports", actions: [{ key: "view" }, { key: "export" }] },
  { key: "audit", label: "Audit log", actions: [{ key: "view" }, { key: "export" }] },
  { key: "settings", label: "Settings", actions: [{ key: "administer", label: "Manage settings", hint: "Company, template, rates, notifications" }] },
];

export const ACTION_LABELS: Record<Action, string> = {
  view: "View", create: "Create", edit: "Edit", delete: "Delete", approve: "Approve", payments: "Payments",
  email: "Email", export: "Export", groups: "Manage groups", administer: "Manage settings",
};

/** Keep only modules/actions that exist (anything else in stored JSON is ignored). */
export function normalizePerms(raw: unknown): Perms {
  const out: Perms = {};
  if (!raw || typeof raw !== "object") return out;
  for (const m of MODULES) {
    const list = (raw as Record<string, unknown>)[m.key];
    if (!Array.isArray(list)) continue;
    const allowed = m.actions.map((a) => a.key).filter((a) => list.includes(a));
    if (allowed.length) out[m.key] = allowed;
  }
  return out;
}

/** Everything — used to check that at least one group keeps full user/group control. */
export const ALL_PERMS: Perms = Object.fromEntries(MODULES.map((m) => [m.key, m.actions.map((a) => a.key)]));

export type PermSubject = { perms: Perms } | null | undefined;

export function can(subject: PermSubject, module: Module, action: Action): boolean {
  return subject?.perms[module]?.includes(action) ?? false;
}

export class ForbiddenError extends Error {
  constructor(module: Module, action: Action) {
    super(`You do not have permission to ${ACTION_LABELS[action].toLowerCase()} ${module}.`);
    this.name = "ForbiddenError";
  }
}

/** Business-rule failure with a message safe to show to users. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}
