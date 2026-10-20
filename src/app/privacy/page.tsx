import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — HubChat',
  description: 'นโยบายความเป็นส่วนตัวของ HubChat',
};

/**
 * หน้า Privacy Policy — เข้าถึงได้โดยไม่ต้อง login
 * =========================================================================
 * ⚠️ หน้านี้จำเป็นสำหรับ Meta App Review
 *    Meta กำหนดให้แอพทุกตัวต้องมี Privacy Policy URL ที่เข้าถึงได้สาธารณะ
 *    ถ้าไม่มี จะส่ง App Review ไม่ได้ / ถูกปฏิเสธทันที
 */
export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-sm leading-relaxed text-foreground/90">
      <h1 className="mb-8 text-2xl font-bold text-foreground">Privacy Policy</h1>
      <p className="mb-4 text-muted-foreground">Last updated: October 20, 2026</p>

      <Section title="1. Introduction">
        <p>
          HubChat (&quot;we&quot;, &quot;our&quot;, or &quot;the Application&quot;) is a social media inbox
          management tool operated by Blisse Thailand. This Privacy Policy explains how we collect, use,
          store, and protect information when you interact with our Facebook Page, Instagram account,
          or our web application.
        </p>
      </Section>

      <Section title="2. Information We Collect">
        <p>We collect the following types of information through the Meta (Facebook/Instagram) APIs:</p>
        <ul className="mt-2 list-disc pl-6 space-y-1">
          <li><strong>Messages:</strong> Text content, timestamps, and attachments from conversations initiated by you through Facebook Messenger or Instagram Direct Messages.</li>
          <li><strong>Comments:</strong> Public comments you leave on our Facebook Page posts or Instagram posts.</li>
          <li><strong>Profile Information:</strong> Your public name, profile picture URL, and user/page-scoped ID as provided by Meta.</li>
          <li><strong>Engagement Data:</strong> Likes, reactions, and read receipts on messages and comments.</li>
        </ul>
        <p className="mt-2">
          We also store information you provide to our team for customer service and order fulfillment,
          such as recipient names, telephone numbers, delivery addresses, order details, and payment
          slips. Staff may record customer notes and tags to manage your requests.
        </p>
      </Section>

      <Section title="3. How We Use Your Information">
        <p>We use the collected information solely for the following purposes:</p>
        <ul className="mt-2 list-disc pl-6 space-y-1">
          <li><strong>Customer Support:</strong> To read and respond to your messages and comments in a timely manner.</li>
          <li><strong>Order Management:</strong> To assist with product inquiries, orders, and shipping updates when you contact us via Messenger or Instagram DM.</li>
          <li><strong>Comment Moderation:</strong> To monitor, reply to, and moderate comments on our social media posts.</li>
          <li><strong>Service Improvement:</strong> To understand customer needs and improve our response quality.</li>
          <li><strong>Staff Notifications:</strong> To notify authorized staff about incoming messages, comments, and conversations awaiting a response.</li>
          <li><strong>Optional AI Assistance:</strong> When enabled, to suggest or generate replies using relevant message or comment content and business information.</li>
        </ul>
      </Section>

      <Section title="4. Data Storage and Security">
        <p>Your data is stored securely with the following measures:</p>
        <ul className="mt-2 list-disc pl-6 space-y-1">
          <li>Records are stored in <strong>Supabase</strong>; message attachments and payment slips may also be stored in Supabase Storage.</li>
          <li>Stored media is served through public file URLs so that messaging services can retrieve it. Anyone with a file URL may access that file; these URLs should not be shared beyond their intended recipients.</li>
          <li>Sensitive tokens (such as Page Access Tokens) are encrypted using <strong>AES-256-GCM</strong> before storage.</li>
          <li>Access to the application is restricted to authorized administrators only, protected by session-based authentication.</li>
          <li>All connections use <strong>HTTPS/TLS</strong> encryption in transit.</li>
        </ul>
      </Section>

      <Section title="5. Data Sharing">
        <p>
          We do <strong>not</strong> sell your personal information. Authorized staff and service
          providers process relevant data for the purposes described above. These services include:
        </p>
        <ul className="mt-2 list-disc pl-6 space-y-1">
          <li><strong>Meta Platforms (Facebook/Instagram):</strong> As the source and destination of messages and comments.</li>
          <li><strong>Supabase:</strong> As our database hosting provider (data encrypted at rest).</li>
          <li><strong>Vercel:</strong> As our application hosting provider.</li>
          <li><strong>Telegram:</strong> When configured, to deliver staff notifications that may include a customer name and message or comment preview.</li>
          <li><strong>Browser Push Services:</strong> To deliver encrypted notifications to subscribed staff devices. Notification previews may appear on those devices.</li>
          <li><strong>Google Gemini:</strong> When AI features are enabled and used, to process relevant conversation or comment text, customer context, and configured business information for reply generation.</li>
        </ul>
      </Section>

      <Section title="6. Data Retention">
        <p>
          We retain your message and comment data for as long as it is necessary to provide customer support
          and maintain conversation history. You may request deletion of your data at any time
          (see Section 8 below).
        </p>
      </Section>

      <Section title="7. Your Rights">
        <p>You have the right to:</p>
        <ul className="mt-2 list-disc pl-6 space-y-1">
          <li><strong>Access:</strong> Request a copy of the data we hold about you.</li>
          <li><strong>Deletion:</strong> Request that we delete all data associated with your account.</li>
          <li><strong>Correction:</strong> Request correction of any inaccurate data.</li>
          <li><strong>Contact Preferences:</strong> Ask our team to stop contacting you. Stopping a conversation does not automatically delete information already stored.</li>
        </ul>
      </Section>

      <Section title="8. Data Deletion">
        <p>
          You can request deletion of your data in any of the following ways:
        </p>
        <ul className="mt-2 list-disc pl-6 space-y-1">
          <li>
            <strong>Through Meta:</strong> Where Meta offers a data deletion request for this app,
            you can use that option. When Meta sends us a valid deletion callback, we record the
            request and return a confirmation code and status URL. An authorized administrator
            verifies the identity and records covered by the request before deletion.
          </li>
          <li>
            <strong>Direct Contact:</strong> Send us a message through our Facebook Page
            (&quot;Blisse Thailand&quot;) requesting data deletion. We will process your request within
            30 days.
          </li>
        </ul>
      </Section>

      <Section title="9. Meta Platform Data Use">
        <p>
          Our use of information received from Meta APIs adheres to the{' '}
          <a
            href="https://developers.facebook.com/terms/"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            Meta Platform Terms
          </a>{' '}
          and{' '}
          <a
            href="https://developers.facebook.com/devpolicy/"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            Meta Developer Policy
          </a>
          . We only request the permissions necessary for our stated functionality and do not use data
          for advertising, profiling, or any purpose beyond customer communication management.
        </p>
      </Section>

      <Section title="10. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. Any changes will be reflected on this page
          with an updated &quot;Last updated&quot; date. Continued use of our services after changes
          constitutes acceptance of the updated policy.
        </p>
      </Section>

      <Section title="11. Contact Us">
        <p>
          If you have any questions about this Privacy Policy or wish to exercise your data rights,
          please contact us:
        </p>
        <ul className="mt-2 list-disc pl-6 space-y-1">
          <li><strong>Facebook Page:</strong> <a href="https://www.facebook.com/BlisseThailand" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">Blisse Thailand</a></li>
          <li><strong>Application:</strong> HubChat</li>
        </ul>
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
