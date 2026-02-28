import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Quantalyze",
};

const LAST_UPDATED = "28 February 2026";
const CONTACT_EMAIL = "hello@quantalyze.me";
const COMPANY = "Quantalyze";
const SITE = "https://quantalyze.me";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Nav */}
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight text-white">
          Quantalyze
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
        >
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-12">
        <h1 className="mb-2 text-3xl font-bold text-white">Privacy Policy</h1>
        <p className="mb-12 text-sm text-white/40">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-10 text-[15px] leading-relaxed text-white/70">

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">1. Who we are</h2>
            <p>
              {COMPANY} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) operates the
              website at <a href={SITE} className="text-sky-400 hover:underline">{SITE}</a> and
              provides an AI-powered earnings transcript analysis platform for financial
              research professionals. This Privacy Policy explains how we collect, use,
              and protect your information when you use our service.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">2. Information we collect</h2>
            <div className="space-y-4">
              <div>
                <h3 className="mb-1 text-sm font-medium text-white/90">Account information</h3>
                <p>When you create an account we collect your email address and, if you sign
                  in with Google, your Google account name and profile picture.</p>
              </div>
              <div>
                <h3 className="mb-1 text-sm font-medium text-white/90">OAuth tokens</h3>
                <p>If you connect your Gmail account, we store OAuth access and refresh tokens
                  solely to send analysis reports on your behalf. If you connect Slack, we
                  store your workspace&apos;s bot token to support the{" "}
                  <code className="rounded bg-white/10 px-1 text-xs">/earnings</code> slash
                  command. You can revoke these at any time from Settings → Connections.</p>
              </div>
              <div>
                <h3 className="mb-1 text-sm font-medium text-white/90">Analysis results</h3>
                <p>When you run an earnings analysis, the resulting structured data (signal
                  scores, takeaways, quotes) is stored in our database to power result caching
                  and your analysis history.</p>
              </div>
              <div>
                <h3 className="mb-1 text-sm font-medium text-white/90">Usage data</h3>
                <p>We collect standard server logs including IP addresses, browser type, and
                  pages visited for security monitoring and service improvement. We do not use
                  third-party analytics trackers.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">3. How we use your information</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>To authenticate you and maintain your account</li>
              <li>To run earnings analysis on your behalf using AI models</li>
              <li>To send emails you explicitly request via the &ldquo;Send via Gmail&rdquo; feature</li>
              <li>To post Slack messages in response to slash commands you invoke</li>
              <li>To cache analysis results so subsequent identical requests are served instantly</li>
              <li>To respond to your support requests</li>
            </ul>
            <p className="mt-4">
              We do not sell your data, use it for advertising, or share it with third parties
              except as described in Section 4.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">4. Third-party services</h2>
            <p className="mb-4">We use the following sub-processors to operate the service:</p>
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-4 py-3 text-left font-medium text-white/80">Service</th>
                    <th className="px-4 py-3 text-left font-medium text-white/80">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {[
                    ["Supabase", "Database, authentication, and file storage"],
                    ["Google Gemini API", "AI analysis of earnings transcripts"],
                    ["Gmail API (Google)", "Sending reports on your behalf (only when you use this feature)"],
                    ["Slack API", "Posting analysis results to your Slack workspace"],
                    ["Vercel", "Application hosting and edge functions"],
                    ["Yahoo Finance", "Fetching historical stock price data for market validation"],
                  ].map(([svc, purpose]) => (
                    <tr key={svc}>
                      <td className="px-4 py-3 text-white/60 font-medium">{svc}</td>
                      <td className="px-4 py-3 text-white/50">{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4">
              Earnings call transcript text is transmitted to Google&apos;s Gemini API for AI
              analysis. These transcripts are public documents filed with stock exchanges and
              do not contain your personal data.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">5. Data retention</h2>
            <p>
              We retain your account data for as long as your account is active. Analysis
              results are retained indefinitely to support caching and history features.
              OAuth tokens are stored until you revoke the connection or delete your account.
              You may request deletion of your data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">6. Security</h2>
            <p>
              All data is encrypted in transit via TLS. OAuth tokens are stored encrypted
              at rest in our database. We use Supabase Row Level Security to ensure users
              can only access their own data. We do not log or store the content of
              earnings transcripts beyond what is necessary to compute the analysis.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">7. Your rights</h2>
            <p className="mb-2">You have the right to:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your account and associated data</li>
              <li>Revoke Gmail or Slack OAuth access at any time from Settings → Connections</li>
              <li>Withdraw consent for any processing based on consent</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, email us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-sky-400 hover:underline">
                {CONTACT_EMAIL}
              </a>.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">8. Cookies</h2>
            <p>
              We use only essential session cookies set by Supabase Auth to maintain your
              login state. We do not use tracking or advertising cookies.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">9. Changes to this policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of
              material changes by email or by posting a notice on the platform. Continued
              use of the service after changes are posted constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">10. Contact</h2>
            <p>
              If you have any questions about this Privacy Policy or how we handle your
              data, please contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-sky-400 hover:underline">
                {CONTACT_EMAIL}
              </a>.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 px-6 py-8 text-xs text-white/30 sm:flex-row">
          <span>© {new Date().getFullYear()} Quantalyze. All rights reserved.</span>
          <div className="flex gap-6">
            <Link href="/privacy" className="text-white/50">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-white/60 transition">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
