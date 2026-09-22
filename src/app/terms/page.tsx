import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — HubChat',
  description: 'เงื่อนไขการใช้บริการ HubChat',
};

/**
 * หน้า Terms of Service — เข้าถึงได้โดยไม่ต้อง login
 * =========================================================================
 * ⚠️ หน้านี้จำเป็นสำหรับ Meta App Review
 */
export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-sm leading-relaxed text-foreground/90">
      <h1 className="mb-8 text-2xl font-bold text-foreground">Terms of Service</h1>
      <p className="mb-4 text-muted-foreground">Last updated: September 22, 2026</p>

      <Section title="1. Acceptance of Terms">
        <p>
          By interacting with our Facebook Page (&quot;Blisse Thailand&quot;), Instagram account, or
          using the HubChat application, you agree to these Terms of Service. If you do not agree,
          please discontinue use of our services.
        </p>
      </Section>

      <Section title="2. Description of Service">
        <p>
          HubChat is a social media inbox management tool that enables our team to receive and respond to
          messages and comments from customers across Facebook Messenger, Instagram Direct Messages, and
          social media comments. The service is operated by Blisse Thailand for customer support and
          engagement purposes.
        </p>
      </Section>

      <Section title="3. User Conduct">
        <p>When interacting with us through our social media channels, you agree to:</p>
        <ul className="mt-2 list-disc pl-6 space-y-1">
          <li>Provide accurate information when communicating with our team.</li>
          <li>Not send abusive, harassing, or inappropriate content.</li>
          <li>Not attempt to exploit or misuse our messaging systems.</li>
          <li>Comply with Meta&apos;s Community Standards and Terms of Service.</li>
        </ul>
      </Section>

      <Section title="4. Privacy">
        <p>
          Your privacy is important to us. Please review our{' '}
          <a href="/privacy" className="text-primary underline underline-offset-2">
            Privacy Policy
          </a>{' '}
          for information on how we collect, use, and protect your data.
        </p>
      </Section>

      <Section title="5. Intellectual Property">
        <p>
          All content, branding, and materials associated with HubChat and Blisse Thailand are the
          property of their respective owners. You may not reproduce, distribute, or create derivative
          works from our content without prior written permission.
        </p>
      </Section>

      <Section title="6. Limitation of Liability">
        <p>
          HubChat is provided &quot;as is&quot; without warranties of any kind. We are not liable for
          any indirect, incidental, or consequential damages arising from your use of our services,
          including but not limited to delays in message responses or temporary service interruptions.
        </p>
      </Section>

      <Section title="7. Modifications">
        <p>
          We reserve the right to modify these Terms of Service at any time. Changes will be posted on
          this page with an updated &quot;Last updated&quot; date. Continued use of our services after
          changes constitutes acceptance of the revised terms.
        </p>
      </Section>

      <Section title="8. Governing Law">
        <p>
          These Terms of Service are governed by the laws of the Kingdom of Thailand. Any disputes
          arising from these terms will be subject to the jurisdiction of Thai courts.
        </p>
      </Section>

      <Section title="9. Contact">
        <p>
          For questions about these Terms, please contact us through our{' '}
          <a
            href="https://www.facebook.com/BlisseThailand"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            Facebook Page
          </a>
          .
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-foreground">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
