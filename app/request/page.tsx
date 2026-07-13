import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import RequestClient from "./RequestClient";

export default async function RequestPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return <RequestClient />;
}
