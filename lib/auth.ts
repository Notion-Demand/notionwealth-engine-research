import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

/**
 * Verify the Supabase JWT from the Authorization: Bearer <token> header.
 * Returns the authenticated user's ID.
 * Throws "Unauthorized" if missing or invalid.
 */
export async function getUserId(req: NextRequest): Promise<string> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const token = authHeader.slice(7);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) throw new Error("Unauthorized");
  return user.id;
}
