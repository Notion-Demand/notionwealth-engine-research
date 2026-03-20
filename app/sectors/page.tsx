import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import SectorsClient from "./SectorsClient";

export default async function SectorsPage() {
    const supabase = await createClient();
    const {
        data: { session },
    } = await supabase.auth.getSession();

    if (!session) redirect("/login");

    return (
        <Suspense>
            <SectorsClient />
        </Suspense>
    );
}
