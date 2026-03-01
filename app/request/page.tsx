import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RequestClient from "./RequestClient";

export default async function RequestPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  return <RequestClient />;
}
