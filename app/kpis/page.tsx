import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import KPIsClient from "./KPIsClient";

export const metadata = {
    title: "KPI Tracker — Quantalyze",
    description:
        "Scan top quarterly KPI changes across earnings — revenue growth, margin shifts, sector-specific drivers.",
};

export default async function KPIsPage() {
    const supabase = await createClient();
    const {
        data: { session },
    } = await supabase.auth.getSession();

    if (!session) redirect("/login");

    return (
        <Suspense>
            <KPIsClient />
        </Suspense>
    );
}
