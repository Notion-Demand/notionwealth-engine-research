import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

export const { handlers, auth, signIn, signOut } = NextAuth({
  debug: true,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  // Auth.js only auto-trusts the incoming Host header on platforms it can
  // detect (e.g. Vercel, via its own env var). Azure App Service isn't
  // recognized, so without this every request is rejected with
  // "UntrustedHost" — found by testing the real deployment, not caught by
  // type-checking. Safe here since App Service's own routing already
  // guarantees the Host header matches this app's actual bound domain.
  trustHost: true,
  // Without this, Auth.js redirects unauthenticated access and sign-in
  // errors to its own built-in pages instead of this app's /login page —
  // LoginClient.tsx (Task 7) reads `?error=...` off the URL, which only
  // arrives here because pages.signIn is set.
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Every Postgres table's user_id column is typed UUID (matching Supabase's
    // UUID-based auth.users.id, unchanged by the Data+Storage migration).
    // account.providerAccountId maps to the OIDC `sub` claim, which for
    // Microsoft Entra External ID is an opaque pairwise identifier, NOT a
    // UUID (e.g. "vZy-_Fa8xnKr..." instead of a GUID) — this broke every
    // credits/analysis query with "invalid input syntax for type uuid",
    // found by testing the real deployment, not caught by type-checking.
    // Entra's `oid` claim is the user's actual Object ID in the tenant and
    // IS a real GUID (matching what Microsoft Graph assigns/returns when
    // creating users), so it's used here instead.
    async jwt({ token, account, profile }) {
      if (account) {
        token.sub = (profile?.oid as string | undefined) ?? account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
