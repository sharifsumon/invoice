import { z } from "zod";
import { NumberReset } from "@/generated/prisma/enums";
import { audit, inTx, type Actor, type Db } from "./common";
import { dec } from "./money";
import { can, ForbiddenError, RuleError } from "./permissions";
import { saveFile, sniffImage } from "./storage";

const opt = z.string().trim().max(5000).optional().transform((v) => (v ? v : null));

export const companyInput = z.object({
  legalName: z.string().trim().min(1, "Legal name is required").max(300),
  displayName: z.string().trim().min(1, "Display name is required").max(300),
  address: opt, email: opt, phone: opt, website: opt, registrationNumber: opt, taxNumber: opt,
  defaultCurrency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  bankDetails: opt,
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  defaultNotes: opt,
  /** Prefix for auto-numbered project codes, e.g. "PRJ-" → PRJ-0001. Omitted = unchanged. */
  projectCodePrefix: z.string().trim().max(20).regex(/^[A-Za-z0-9/_-]*$/, "Project code prefix may contain letters, digits, - _ /").optional(),
});

export const templateInput = z.object({
  title: z.string().trim().min(1).max(60),
  logoPosition: z.enum(["left", "right"]),
  headerText: opt,
  footerText: opt,
  pageSize: z.enum(["A4", "LETTER"]),
  numberPrefix: z.string().max(20).regex(/^[A-Za-z0-9/_-]*$/, "Prefix may contain letters, digits, - _ /"),
  numberPadding: z.coerce.number().int().min(1).max(10),
  numberReset: z.nativeEnum(NumberReset),
  showTax: z.boolean(),
  taxLabel: z.string().trim().min(1).max(20),
  defaultTaxRate: z.string(),
  defaultTerms: opt,
  showAmountInWords: z.boolean(),
});

function admin(actor: Actor) {
  if (!can(actor, "settings", "administer")) throw new ForbiddenError("settings", "administer");
}

export async function getSettings(db: Db) {
  const [company, template] = await Promise.all([
    db.companySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    db.invoiceTemplateSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
  ]);
  return { company, template };
}

export async function updateCompany(db: Db, actor: Actor, raw: z.input<typeof companyInput>) {
  admin(actor);
  const data = companyInput.parse(raw);
  return inTx(db, async (tx) => {
    const before = await tx.companySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const after = await tx.companySettings.update({ where: { id: 1 }, data });
    await audit(tx, actor, "settings.company.updated", "CompanySettings", "1", { before, after });
    return after;
  });
}

export async function updateTemplate(db: Db, actor: Actor, raw: z.input<typeof templateInput>) {
  admin(actor);
  const data = templateInput.parse(raw);
  const rate = dec(data.defaultTaxRate || "0");
  if (rate.lt(0) || rate.gt(100)) throw new RuleError("Tax rate must be between 0 and 100");
  return inTx(db, async (tx) => {
    const before = await tx.invoiceTemplateSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const after = await tx.invoiceTemplateSettings.update({ where: { id: 1 }, data: { ...data, defaultTaxRate: rate } });
    await audit(tx, actor, "settings.template.updated", "InvoiceTemplateSettings", "1", { before, after });
    return after;
  });
}

/** Logo upload: PNG/JPEG only, validated by magic bytes, ≤ 2 MB, stored privately under a content hash. */
export async function uploadLogo(db: Db, actor: Actor, data: Buffer) {
  admin(actor);
  if (data.length > 2 * 1024 * 1024) throw new RuleError("Logo must be 2 MB or smaller");
  const mime = sniffImage(data);
  if (!mime) throw new RuleError("Logo must be a PNG or JPEG image");
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(data).digest("hex");
  const file = await saveFile(`branding/${sha}.${mime === "image/png" ? "png" : "jpg"}`, data);
  return inTx(db, async (tx) => {
    const before = await tx.companySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    await tx.companySettings.update({ where: { id: 1 }, data: { logoPath: file.path, logoMime: mime } });
    await audit(tx, actor, "settings.logo.updated", "CompanySettings", "1", { before: { logoPath: before.logoPath }, after: { logoPath: file.path } });
  });
}

export async function removeLogo(db: Db, actor: Actor) {
  admin(actor);
  return inTx(db, async (tx) => {
    await tx.companySettings.update({ where: { id: 1 }, data: { logoPath: null, logoMime: null } });
    await audit(tx, actor, "settings.logo.removed", "CompanySettings", "1");
  });
}

// Users and groups live in ./users (re-exported for existing imports).
export { checkPassword, PASSWORD_RULE, createUser, updateUser, userInput } from "./users";
