import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import KPIsClient from "./KPIsClient";

export const metadata = {
    title: "KPI Tracker — Quantalyze",
    description:
        "Scan top quarterly KPI changes across earnings — revenue growth, margin shifts, sector-specific drivers.",
};

export default async function KPIsPage() {
    const user = await getCurrentUser();

    if (!user) redirect("/login");

    return (
        <Suspense>
            <KPIsClient />
        </Suspense>
    );
}
