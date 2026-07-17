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
    // Entra's OIDC `sub` claim (the user's unique ID in this tenant) is on
    // the `token`, not the default `session.user` shape — Auth.js does not
    // expose an ID on session.user unless a callback copies it there. Every
    // consumer in this app needs a stable user ID (matching what the old
    // Supabase `user.id` provided), so this callback is required, not optional.
    async jwt({ token, account }) {
      if (account) {
        token.sub = account.providerAccountId;
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
