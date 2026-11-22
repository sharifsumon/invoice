import type { Role } from "@/generated/prisma/enums";

export type Module = "clients" | "projects" | "pos" | "invoices" | "settings" | "users" | "audit" | "reports";
export type Action = "view" | "create" | "edit" | "approve" | "cancel" | "export" | "email" | "administer";

type Matrix = Record<Role, Partial<Record<Module, Action[]>>>;

const ALL: Action[] = ["view", "create", "edit", "approve", "cancel", "export", "email", "administer"];

/**
 * BRD §4 role → module/action matrix. Approval authority (BRD §15) defaults:
 * - Projects approved by Management / Admin.
 * - POs approved by Finance / Management / Admin.
 * - Invoices finalized (approve) and cancelled by Finance / Admin.
 */
export const PERMISSIONS: Matrix = {
  ADMIN: {
    clients: ALL, projects: ALL, pos: ALL, invoices: ALL, settings: ALL, users: ALL, audit: ["view", "export"], reports: ["view", "export"],
  },
  MANAGEMENT: {
    clients: ["view", "export"],
    projects: ["view", "approve", "export"],
    pos: ["view", "approve", "export"],
    invoices: ["view", "export"],
    audit: ["view"],
    reports: ["view", "export"],
  },
  BUSINESS_DEVELOPMENT: {
    clients: ["view", "create", "edit", "export"],
    projects: ["view", "create", "edit"],
    pos: ["view"],
    invoices: ["view"],
  },
  PROJECT_MANAGER: {
    clients: ["view"],
    projects: ["view", "create", "edit"],
    pos: ["view"],
    invoices: ["view"],
  },
  FINANCE: {
    clients: ["view", "export"],
    projects: ["view"],
    pos: ["view", "create", "edit", "approve", "cancel", "export"],
    invoices: ["view", "create", "edit", "approve", "cancel", "export", "email"],
    reports: ["view", "export"],
  },
  VIEWER: {
    clients: ["view"],
    projects: ["view"],
    pos: ["view"],
    invoices: ["view"],
    reports: ["view"],
  },
};

export function can(role: Role, module: Module, action: Action): boolean {
  return PERMISSIONS[role]?.[module]?.includes(action) ?? false;
}

export class ForbiddenError extends Error {
  constructor(module: Module, action: Action) {
    super(`You do not have permission to ${action} ${module}.`);
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

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGEMENT: "Management",
  BUSINESS_DEVELOPMENT: "Business Development",
  PROJECT_MANAGER: "Project Manager",
  FINANCE: "Finance",
  VIEWER: "Viewer",
};
