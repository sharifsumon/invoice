import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Private file storage on local disk (outside /public). Swap for S3 later behind the same interface. */
export function storageRoot() {
  // Runtime data directory, not source: tell the bundler's file tracer not to follow it.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_DIR || "./storage");
}

function safeResolve(rel: string) {
  const root = storageRoot();
  const full = path.resolve(/*turbopackIgnore: true*/ root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage path");
  return full;
}

export async function saveFile(rel: string, data: Buffer) {
  const full = safeResolve(rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return { path: rel.replace(/\\/g, "/"), sha256: createHash("sha256").update(data).digest("hex"), size: data.length };
}

export async function loadFile(rel: string) {
  return readFile(safeResolve(rel));
}

/** Validate an uploaded logo by magic bytes, not by extension/declared type. */
export function sniffImage(buf: Buffer): "image/png" | "image/jpeg" | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}
