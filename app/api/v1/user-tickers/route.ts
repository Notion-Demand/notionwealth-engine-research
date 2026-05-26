import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export interface UserTicker {
    ticker: string;
    name: string;
    sector: string;
    added_at: string;
}

// ── GET — list caller's custom tickers ───────────────────────────────────────

export async function GET() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
        .from("user_tickers")
        .select("ticker, name, sector, added_at")
        .order("added_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
}

// ── POST — add a ticker to caller's list ─────────────────────────────────────

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const ticker: string = (body.ticker ?? "").toUpperCase().trim();
    const name:   string = (body.name   ?? ticker).trim();
    const sector: string = (body.sector ?? "Custom").trim();

    if (!ticker || !/^[A-Z0-9&.-]{1,20}$/.test(ticker)) {
        return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    }

    const { data, error } = await supabase
        .from("user_tickers")
        .upsert(
            { user_id: user.id, ticker, name: name || ticker, sector },
            { onConflict: "user_id,ticker" }
        )
        .select("ticker, name, sector, added_at")
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
}

// ── DELETE — remove a ticker from caller's list ──────────────────────────────

export async function DELETE(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker")?.toUpperCase();
    if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

    await supabase
        .from("user_tickers")
        .delete()
        .eq("user_id", user.id)
        .eq("ticker", ticker);

    return NextResponse.json({ ok: true });
}
