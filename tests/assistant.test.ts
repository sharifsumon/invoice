import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { PaymentMethod, ProjectStatus } from "@/generated/prisma/enums";
import { createClient } from "@/server/core/clients";
import { createProject, transitionProject } from "@/server/core/projects";
import { approvePO, createPO } from "@/server/core/pos";
import { createManualInvoice, finalizeInvoice } from "@/server/core/invoices";
import { recordPayment } from "@/server/core/payments";
import { aiConfig, decryptSecret, encryptSecret, updateAiSettings } from "@/server/core/ai";
import { askAssistant } from "@/server/core/assistant";
import { createExport } from "@/server/core/assistant-export";
import { loadFile } from "@/server/core/storage";
import { createGroup, createUser } from "@/server/core/users";
import { loadActor, type Actor } from "@/server/core/common";
import { baseSettings, cl, ct, makeActor, Role, testDb, uid } from "./helpers";

const db = testDb();
let admin: Actor;
let finance: Actor;
let poNumber: string;
let invoiceNumber: string;

beforeAll(async () => {
  await baseSettings(db);
  admin = await makeActor(db, Role.ADMIN);
  finance = await makeActor(db, Role.FINANCE);
  const c = await createClient(db, admin, cl(uid("AI Client")), [ct("Ada", "Assist")]);
  const p = await createProject(db, admin, { code: uid("AI"), name: "AI project", clientId: c.id, value: "9000" });
  await transitionProject(db, admin, p.id, ProjectStatus.IN_PROGRESS, { approvalDate: "2026-02-01" });
  poNumber = uid("AIPO");
  const po = await createPO(db, finance, { poNumber, projectId: p.id, poDate: "2026-02-02", value: "5000" });
  await approvePO(db, finance, po.id);
  const inv = await createManualInvoice(db, finance, { poId: po.id, lines: [{ description: "Build", unitPrice: "3000" }] });
  const fin = await finalizeInvoice(db, finance, inv.id, { invoiceDate: "2026-02-03", dueDate: "2026-03-03" });
  invoiceNumber = fin.invoiceNumber!;
  await recordPayment(db, finance, fin.id, { amount: "1000", paymentDate: "2026-02-10", method: PaymentMethod.BANK_TRANSFER });
  stubModels();
  await updateAiSettings(db, admin, { apiKey: "AIza-test-key-123", model: "gemini-test" });
  vi.unstubAllGlobals();
});

/** Fake Google model list (what the key may use). */
function stubModels() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    expect(url).toContain("/models?");
    return new Response(JSON.stringify({ models: [
      { name: "models/gemini-test", displayName: "Gemini Test", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-flash-latest", displayName: "Gemini Flash Latest", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-robotics-x", supportedGenerationMethods: ["generateContent"] },
    ] }), { status: 200 });
  }));
}
afterAll(async () => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());

type Part = Record<string, unknown>;
/** Fake Gemini: returns the scripted model turns in order and records every request body. */
function fakeGemini(turns: Part[][]) {
  const bodies: { contents: { role: string; parts: Part[] }[]; tools?: { functionDeclarations: { name: string }[] }[] }[] = [];
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toContain("models/gemini-test:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test-key-123");
    bodies.push(JSON.parse(String(init.body)));
    const parts = turns[Math.min(i++, turns.length - 1)];
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] }), { status: 200 });
  }));
  return bodies;
}

describe("AI assistant", () => {
  it("stores the API key encrypted and decrypts it for use", async () => {
    const row = await db.companySettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.aiApiKeyEnc).toBeTruthy();
    expect(row.aiApiKeyEnc).not.toContain("AIza");
    expect((await aiConfig(db)).apiKey).toBe("AIza-test-key-123");
    expect(decryptSecret(encryptSecret("x-y-z"))).toBe("x-y-z");
    expect(decryptSecret("garbage")).toBeNull();
    await expect(updateAiSettings(db, finance, { model: "m" })).rejects.toThrow(/permission/);
  });

  it("refuses to save a model the key can't use (typos, retired models)", async () => {
    stubModels();
    await expect(updateAiSettings(db, admin, { model: "gemini-flash-lates" })).rejects.toThrow(/isn't available to this API key.*gemini-flash-latest/);
    expect((await aiConfig(db)).model).toBe("gemini-test"); // unchanged
    const { listModels } = await import("@/server/core/ai");
    expect((await listModels("k")).map((m) => m.name)).toEqual(["gemini-test", "gemini-flash-latest"]); // non-chat models hidden
  });

  it("answers from tool results: looks up a PO, then exports the invoice list to Excel", async () => {
    const bodies = fakeGemini([
      [{ functionCall: { name: "get_purchase_order", args: { po_number: poNumber } }, thoughtSignature: "sig-1" }],
      [{ functionCall: { name: "find_invoices", args: { po_number: poNumber } } }],
      [{ functionCall: { name: "create_export", args: { title: "PO invoices", format: "xlsx", source_table: "find_invoices#1" } } }],
      [{ text: `PO ${poNumber} has 1 invoice; 2,000.00 USD is outstanding.` }],
    ]);
    const r = await askAssistant(db, admin, [{ role: "user", text: `Details of PO ${poNumber} and export its invoices to Excel` }]);
    expect(r.steps).toEqual(["get_purchase_order", "find_invoices", "create_export"]);
    expect(r.text).toContain("outstanding");
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toMatchObject({ format: "xlsx", title: "PO invoices" });

    // The PO lookup returned real figures to the model, and the model's own parts (thought signature) were sent back
    const poResult = (bodies[1].contents.at(-1)!.parts[0] as { functionResponse: { response: { result: Record<string, unknown> } } }).functionResponse.response.result;
    expect(poResult).toMatchObject({ po: poNumber, value: 5000, invoiced_issued: 3000, collected: 1000, outstanding: 2000, left_to_invoice: 2000 });
    expect(bodies[1].contents.at(-2)!.parts[0]).toMatchObject({ thoughtSignature: "sig-1" });

    // The Excel file holds the invoice row and an exact total
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await loadFile(`assistant/${admin.id}/${r.files[0].name}`)) as unknown as ArrayBuffer);
    const values = wb.worksheets[0].getSheetValues().flat().map(String);
    expect(values).toContain(invoiceNumber);
    expect(values).toContain("Total");
    expect(await db.auditLog.count({ where: { action: "assistant.exported", actorId: admin.id } })).toBe(1);
  });

  it("only offers tools for areas the user can view, and refuses users without the assistant permission", async () => {
    const g = await createGroup(db, admin, { name: uid("Sales AI"), permissions: { clients: ["view"], assistant: ["view"] } });
    const u = await createUser(db, admin, { name: "Sam", email: `${uid("sam")}@t.local`, groupId: g.id, password: "Sales-pass-123" });
    const sam = await loadActor(db, u.id);
    const bodies = fakeGemini([[{ functionCall: { name: "find_invoices", args: {} } }], [{ text: "I can't see invoices." }]]);
    const r = await askAssistant(db, sam, [{ role: "user", text: "List invoices" }]);
    const offered = bodies[0].tools![0].functionDeclarations.map((d) => d.name);
    expect(offered).toContain("find_clients");
    expect(offered).not.toContain("find_invoices");
    expect(offered).not.toContain("get_purchase_order");
    // Even if the model calls a tool it wasn't offered, nothing is returned
    const res = (bodies[1].contents.at(-1)!.parts[0] as { functionResponse: { response: { result: { error?: string } } } }).functionResponse.response.result;
    expect(res.error).toMatch(/Unknown tool/);
    expect(r.text).toContain("can't");

    await expect(askAssistant(db, finance, [{ role: "user", text: "hi" }])).rejects.toThrow(/permission/); // Finance has no assistant right by default
  });

  it("when Google is busy: retries, then a backup model answers; if all are busy, a clear message", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const model = /models\/([^:]+):/.exec(url)![1];
      seen.push(model);
      if (model === "gemini-test") return new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 503 });
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Answer from backup." }] }, finishReason: "STOP" }] }), { status: 200 });
    }));
    const r = await askAssistant(db, admin, [{ role: "user", text: "hello" }], [0, 0]);
    expect(seen).toEqual(["gemini-test", "gemini-test", "gemini-test", "gemini-flash-latest"]); // 3 tries, then backup
    expect(r.text).toBe("Answer from backup.");
    expect(r.steps).toContain("fallback:gemini-flash-latest");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "high demand" } }), { status: 503 })));
    await expect(askAssistant(db, admin, [{ role: "user", text: "hello" }], [0, 0])).rejects.toThrow(/busy right now/);
  });

  it("explains a missing key and Google errors in plain language", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), { status: 400 })));
    await expect(askAssistant(db, admin, [{ role: "user", text: "hello" }])).rejects.toThrow(/rejected the API key/);
  });

  it("renders Word and PDF exports", async () => {
    const table = { currency: "USD", columns: [{ key: "a", label: "Client", kind: "text" as const }, { key: "b", label: "Invoiced", kind: "money" as const }], rows: [{ a: "Acme", b: 1200.5 }, { a: "Nova", b: 99.5 }] };
    const docx = await createExport(admin.id, "Clients", "docx", table);
    const pdf = await createExport(admin.id, "Clients", "pdf", table);
    expect((await loadFile(`assistant/${admin.id}/${docx.name}`)).subarray(0, 2).toString()).toBe("PK"); // docx is a zip
    expect((await loadFile(`assistant/${admin.id}/${pdf.name}`)).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
