import { ImageResponse } from "next/og";

/** Share preview (Facebook, LinkedIn, WhatsApp, X…) for invoicehub.online. */
export const alt = "InvoiceHub — Invoice & Billing Software with an AI assistant";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const chips = ["AI assistant", "Purchase orders", "Automatic invoices", "Part payments", "PDF & Excel"];
  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72,
        background: "linear-gradient(135deg, #114a3a 0%, #082c22 70%)", color: "white", fontFamily: "sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "linear-gradient(135deg, #43c19c, #229473)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 800 }}>IH</div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>Invoice<span style={{ color: "#d3e8b4" }}>Hub</span></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 26, letterSpacing: 6, color: "#74d5b6", fontWeight: 700 }}>INVOICE & BILLING SOFTWARE</div>
          <div style={{ marginTop: 18, fontSize: 68, fontWeight: 800, lineHeight: 1.08 }}>From first call to final payment — just ask.</div>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {chips.map((c) => (
            <div key={c} style={{ display: "flex", padding: "10px 20px", borderRadius: 999, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", fontSize: 24 }}>{c}</div>
          ))}
          <div style={{ display: "flex", padding: "10px 20px", borderRadius: 999, background: "#d3e8b4", color: "#082c22", fontSize: 24, fontWeight: 700 }}>Free for 14 days</div>
        </div>
      </div>
    ),
    size,
  );
}
