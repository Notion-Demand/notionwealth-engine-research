import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#ffffff",
          padding: "60px 80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Top bar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, backgroundColor: "#111827" }} />

        {/* Left side */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
          <div style={{ fontSize: 56, fontWeight: 700, color: "#111827", lineHeight: 1.15 }}>
            Quantalyze
          </div>
          <div style={{ fontSize: 22, color: "#6B7280", marginTop: 16, lineHeight: 1.4 }}>
            AI Research Platform for
          </div>
          <div style={{ fontSize: 22, color: "#6B7280", lineHeight: 1.4 }}>
            Indian Equity Investors
          </div>
          <div style={{ fontSize: 18, color: "#9CA3AF", marginTop: 24, lineHeight: 1.6 }}>
            Track management credibility. Spot narrative shifts.
          </div>
          <div style={{ fontSize: 18, color: "#9CA3AF", lineHeight: 1.6 }}>
            Build conviction faster.
          </div>
          <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 40 }}>
            quantalyze.me · by Demandion
          </div>
        </div>

        {/* Right side — signals */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: 380, gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: 40, fontWeight: 700, color: "#111827" }}>200+</div>
              <div style={{ fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 1 }}>Companies</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: 40, fontWeight: 700, color: "#111827" }}>17</div>
              <div style={{ fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 1 }}>Sectors</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: 40, fontWeight: 700, color: "#111827" }}>60s</div>
              <div style={{ fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 1 }}>Analysis</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, backgroundColor: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "10px 16px" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#16A34A" }} />
              <span style={{ fontSize: 14, color: "#166534" }}>Guidance Credibility 8.9/10</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, backgroundColor: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "10px 16px" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#16A34A" }} />
              <span style={{ fontSize: 14, color: "#166534" }}>Executive Evasiveness 2.1/10</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, backgroundColor: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "10px 16px" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#16A34A" }} />
              <span style={{ fontSize: 14, color: "#166534" }}>Promoter Activity: Healthy</span>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
