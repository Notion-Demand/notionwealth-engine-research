import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import ScreenerClient from "./ScreenerClient";

export const metadata = {
    title: "Narrative Screener — Quantalyze",
    description: "Cross-company narrative change screener. See which companies had the biggest messaging shifts this earnings season in NIFTY 200 and much more.",
};

export default async function ScreenerPage() {
    const supabase = await createClient();
    const {
        data: { session },
    } = await supabase.auth.getSession();

    if (!session) redirect("/login");

    return (
        <Suspense>
            <ScreenerClient />
        </Suspense>
    );
}
