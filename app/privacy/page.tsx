import Link from "next/link";

export const metadata = {
  title: "Privacy Policy – Dajaj",
  description: "Privacy Policy for Dajaj food ordering service.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-2xl">
        {/* Back link */}
        <Link href="/menu" className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700">
          ← Back to Menu
        </Link>

        <div className="rounded-[28px] border border-orange-100 bg-white p-8 shadow-sm">
          {/* Header */}
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-orange-500">Legal</p>
          <h1 className="mt-2 text-3xl font-black text-slate-900">Privacy Policy</h1>
          <p className="mt-1 text-sm text-slate-400">Last updated: 06 April 2026</p>

          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            At Dajaj, we value your privacy and are committed to protecting your personal information. This Privacy Policy explains
            how we collect, use, and safeguard your data when you use our services.
          </p>

          <div className="mt-8 space-y-8 text-sm leading-relaxed text-slate-700">

            <Section number="1" title="Information We Collect">
              <SubHeading>a. Personal Information</SubHeading>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600">
                <li>Phone number</li>
                <li>Name (if provided)</li>
                <li>Account-related identifiers</li>
              </ul>
              <SubHeading className="mt-4">b. Usage Data</SubHeading>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600">
                <li>App interactions</li>
                <li>Device type and browser information</li>
                <li>Log data (IP address, timestamps)</li>
              </ul>
              <SubHeading className="mt-4">c. Communication Data</SubHeading>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600">
                <li>Messages sent via WhatsApp or other channels</li>
                <li>Responses to authentication or service-related messages</li>
              </ul>
            </Section>

            <Section number="2" title="How We Use Your Information">
              <p className="mt-2 text-slate-600">We use your data to:</p>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600">
                <li>Provide and maintain our services</li>
                <li>Authenticate users (e.g., login verification via WhatsApp)</li>
                <li>Improve user experience</li>
                <li>Communicate important updates or service-related messages</li>
                <li>Ensure security and prevent fraud</li>
              </ul>
            </Section>

            <Section number="3" title="WhatsApp Communication">
              <p className="mt-2 text-slate-600">By using Dajaj, you agree to receive messages on WhatsApp for:</p>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600">
                <li>Account verification</li>
                <li>Login approvals</li>
                <li>Service-related notifications</li>
              </ul>
              <p className="mt-3 text-slate-600">We do not send promotional messages without consent.</p>
            </Section>

            <Section number="4" title="Data Sharing">
              <p className="mt-2 text-slate-600">
                We do <span className="font-semibold text-slate-800">not sell or rent your personal data</span>.
              </p>
              <p className="mt-3 text-slate-600">We may share data with:</p>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600">
                <li>Trusted service providers (e.g., Meta/WhatsApp APIs)</li>
                <li>Legal authorities if required by law</li>
              </ul>
            </Section>

            <Section number="5" title="Data Security">
              <p className="mt-2 text-slate-600">
                We implement industry-standard security measures to protect your data. However, no system is 100% secure.
              </p>
            </Section>

            <Section number="6" title="Data Retention">
              <p className="mt-2 text-slate-600">We retain your data only as long as necessary to:</p>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600">
                <li>Provide services</li>
                <li>Comply with legal obligations</li>
                <li>Resolve disputes</li>
              </ul>
            </Section>

            <Section number="7" title="Your Rights">
              <p className="mt-2 text-slate-600">You have the right to:</p>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-slate-600">
                <li>Request access to your data</li>
                <li>Request deletion of your data</li>
                <li>Opt out of communications (where applicable)</li>
              </ul>
            </Section>

            <Section number="8" title="Third-Party Services">
              <p className="mt-2 text-slate-600">
                Our service may use third-party tools (e.g., WhatsApp Business API). Their privacy policies also apply.
              </p>
            </Section>

            <Section number="9" title="Changes to This Policy">
              <p className="mt-2 text-slate-600">
                We may update this policy from time to time. Changes will be posted on this page.
              </p>
            </Section>

            <Section number="10" title="Contact Us">
              <p className="mt-2 text-slate-600">If you have any questions, contact us at:</p>
              <div className="mt-3 space-y-1">
                <p>
                  <span className="mr-1">📧</span>
                  <a href="mailto:contact.alttraders@gmail.com" className="font-medium text-orange-600 hover:underline">
                    contact.alttraders@gmail.com
                  </a>
                </p>
                <p>
                  <span className="mr-1">🌐</span>
                  <a href="https://dajaj.in" target="_blank" rel="noopener noreferrer" className="font-medium text-orange-600 hover:underline">
                    dajaj.in
                  </a>
                </p>
              </div>
            </Section>

          </div>

          {/* Footer note */}
          <div className="mt-10 rounded-2xl bg-orange-50 px-5 py-4 text-sm text-orange-800">
            By using Dajaj, you agree to this Privacy Policy.
          </div>
        </div>
      </div>
    </main>
  );
}

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-black text-slate-900">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-600">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function SubHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`font-semibold text-slate-800 ${className}`}>{children}</p>;
}
