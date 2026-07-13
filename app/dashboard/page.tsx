import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <Suspense>
      <DashboardClient />
    </Suspense>
  );
}
