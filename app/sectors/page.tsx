import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import SectorsClient from "./SectorsClient";

export default async function SectorsPage() {
    const user = await getCurrentUser();

    if (!user) redirect("/login");

    return (
        <Suspense>
            <SectorsClient />
        </Suspense>
    );
}
