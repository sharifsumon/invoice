import { createHash } from "node:crypto";
import { audit, inTx, type Actor, type Db } from "./common";
import { can, ForbiddenError, RuleError, type Module } from "./permissions";
import { saveFile } from "./storage";

/** Entity types that accept attachments, and the permission module that governs them. */
export const ATTACHABLE: Record<string, Module> = { PurchaseOrder: "pos" };
export const ATTACHMENT_MAX = 10 * 1024 * 1024;

const OOXML: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Allow-list by content (magic bytes), not by declared type. */
export function sniffAttachment(buf: Buffer, name: string): { mime: string; ext: string } | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50 && ext in OOXML) return { mime: OOXML[ext], ext };
  return null;
}

export async function addAttachment(db: Db, actor: Actor, entityType: string, entityId: string, file: { name: string; data: Buffer }) {
  const mod = ATTACHABLE[entityType];
  if (!mod) throw new RuleError("Attachments are not supported here");
  if (!can(actor.role, mod, "edit")) throw new ForbiddenError(mod, "edit");
  if (!file.data.length) throw new RuleError("Choose a file");
  if (file.data.length > ATTACHMENT_MAX) throw new RuleError("Attachments must be 10 MB or smaller");
  const kind = sniffAttachment(file.data, file.name);
  if (!kind) throw new RuleError("Allowed file types: PDF, PNG, JPEG, Word (.docx), Excel (.xlsx)");
  if (entityType === "PurchaseOrder" && !(await db.purchaseOrder.findUnique({ where: { id: entityId }, select: { id: true } }))) {
    throw new RuleError("PO not found");
  }
  const sha = createHash("sha256").update(file.data).digest("hex");
  const saved = await saveFile(`attachments/${entityType}/${entityId}/${sha}.${kind.ext}`, file.data);
  const fileName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 150) || `file.${kind.ext}`;
  return inTx(db, async (tx) => {
    const a = await tx.attachment.create({
      data: { entityType, entityId, fileName, filePath: saved.path, mimeType: kind.mime, sizeBytes: saved.size, uploadedById: actor.id },
    });
    await audit(tx, actor, "attachment.added", entityType, entityId, { after: { attachmentId: a.id, fileName, sizeBytes: saved.size, sha256: sha } });
    return a;
  });
}

/** Removes the link; the stored file is retained for audit/recovery. */
export async function removeAttachment(db: Db, actor: Actor, id: string, reason: string) {
  const a = await db.attachment.findUniqueOrThrow({ where: { id } });
  const mod = ATTACHABLE[a.entityType];
  if (!mod || !can(actor.role, mod, "edit")) throw new ForbiddenError(mod ?? "pos", "edit");
  if (!reason?.trim()) throw new RuleError("A reason is required to remove an attachment");
  return inTx(db, async (tx) => {
    await tx.attachment.delete({ where: { id } });
    await audit(tx, actor, "attachment.removed", a.entityType, a.entityId, { before: { attachmentId: id, fileName: a.fileName, filePath: a.filePath }, reason: reason.trim() });
  });
}
