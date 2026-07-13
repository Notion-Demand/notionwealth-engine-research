import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { watchlistRepo } from "@/lib/repositories";
import type { WatchlistTicker } from "@/lib/repositories/watchlist";

export const dynamic = "force-dynamic";

export interface UserTicker {
    ticker: string;
    name: string;
    sector: string;
    added_at: string;
}

function toWire(t: WatchlistTicker): UserTicker {
    return { ticker: t.ticker, name: t.name, sector: t.sector, added_at: t.addedAt };
}

// ── GET — list caller's custom tickers ───────────────────────────────────────

export async function GET() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { tickers, error } = await watchlistRepo.list(user.id);

    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json(tickers.map(toWire));
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

    const { ticker: saved, error } = await watchlistRepo.add(user.id, ticker, name, sector);

    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json(saved ? toWire(saved) : null);
}

// ── DELETE — remove a ticker from caller's list ──────────────────────────────

export async function DELETE(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker")?.toUpperCase();
    if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

    await watchlistRepo.remove(user.id, ticker);

    return NextResponse.json({ ok: true });
}
