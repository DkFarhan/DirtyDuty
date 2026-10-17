import type { Metadata } from "next"
import Link from "next/link"
import { ProductLogo } from "@/components/brand/product-logo"
import { getSupportEmail } from "@/components/chore-sync/support-message"

export const metadata: Metadata = {
  title: "Terms of Service | DirtyDuty",
  description: "Terms of Service for DirtyDuty.",
}

function TermsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`terms-${title.split(" ")[0]}`} className="scroll-mt-6">
      <h2
        className="font-display text-lg font-extrabold leading-snug text-slate-900"
        id={`terms-${title.split(" ")[0]}`}
      >
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600">{children}</div>
    </section>
  )
}

export default function TermsPage() {
  const supportEmail = getSupportEmail()

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex min-h-16 max-w-4xl items-center justify-between gap-4 px-5 py-3">
          <Link
            aria-label="Back to DirtyDuty"
            className="flex min-h-10 items-center rounded-lg text-sm font-semibold text-slate-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            href="/"
          >
            <span aria-hidden="true" className="mr-1 text-lg">
              ‹
            </span>
            Back
          </Link>
          <ProductLogo className="h-auto w-32 max-w-[45vw]" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        <article className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-9">
          <header className="mb-8 border-b border-slate-100 pb-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Legal</p>
            <h1 className="mt-2 font-display text-3xl font-black leading-tight text-slate-900 sm:text-4xl">
              DirtyDuty Terms of Service
            </h1>
            <p className="mt-3 text-sm font-medium text-slate-500">
              Effective date: October 16, 2026
            </p>
          </header>

          <div className="space-y-8">
            <TermsSection title="1. Agreement to these Terms">
              <p>
                These Terms of Service (&quot;Terms&quot;) govern your access to and use of
                DirtyDuty, including its website, progressive web application and related services
                (&quot;DirtyDuty&quot; or the &quot;Service&quot;).
              </p>
              <p>
                By creating an account, accessing or using DirtyDuty, you agree to these Terms. If
                you do not agree, do not use the Service.
              </p>
            </TermsSection>

            <TermsSection title="2. Eligibility">
              <p>You must be legally permitted to use the Service and enter into these Terms.</p>
              <p>
                If you are under the age of majority where you live, you may use DirtyDuty only with
                the permission and supervision of a parent or legal guardian.
              </p>
              <p>
                DirtyDuty is not intended for children under 13 to create accounts independently.
              </p>
            </TermsSection>

            <TermsSection title="3. Your account">
              <p>
                You are responsible for maintaining the confidentiality of your account credentials
                and for activity performed through your account.
              </p>
              <p>
                You agree to provide accurate information and to keep your account information
                reasonably up to date.
              </p>
              <p>
                You must notify us if you believe your account has been accessed without
                authorization.
              </p>
              <p>
                You may also use supported third-party authentication methods, such as Google
                Sign-In. Your use of those services remains subject to the applicable third
                party&apos;s terms and policies.
              </p>
            </TermsSection>

            <TermsSection title="4. The DirtyDuty Service">
              <p>
                DirtyDuty helps households organize chores, assignments, schedules, reminders,
                household members and related activity.
              </p>
              <p>
                Features may include chore management, household invitations, notifications,
                activity information and other household-management tools.
              </p>
              <p>
                DirtyDuty is an organizational tool. It is not intended for emergency, medical,
                legal, safety-critical or other situations where failure or delay could cause harm.
              </p>
            </TermsSection>

            <TermsSection title="5. Households, administrators and invitations">
              <p>Users may create or join households.</p>
              <p>
                Household owners and administrators may have additional permissions, including the
                ability to:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>invite members</li>
                <li>create and manage chores</li>
                <li>change household settings</li>
                <li>manage member roles</li>
                <li>remove members</li>
                <li>transfer household ownership</li>
                <li>delete a household</li>
              </ul>
              <p>
                If you create or administer a household, you are responsible for using those
                permissions appropriately.
              </p>
              <p>
                Invitation links or codes should be shared only with people you intend to invite.
                You are responsible for invitations you distribute.
              </p>
            </TermsSection>

            <TermsSection title="6. Your content">
              <p>
                You may provide information to DirtyDuty such as display names, household names,
                chore names, descriptions and other household-related content (&quot;User
                Content&quot;).
              </p>
              <p>You retain ownership of your User Content.</p>
              <p>
                You grant DirtyDuty a limited, non-exclusive licence to host, store, process,
                display and transmit User Content only as reasonably necessary to operate, secure
                and improve the Service.
              </p>
              <p>
                You are responsible for ensuring that your User Content does not violate applicable
                law or the rights of another person.
              </p>
            </TermsSection>

            <TermsSection title="7. Notifications and reminders">
              <p>
                DirtyDuty may provide in-app, push, email or other notifications relating to chores,
                household activity, invitations, account security or Service operation.
              </p>
              <p>
                Notifications are provided for convenience. Delivery may be delayed, interrupted or
                unavailable.
              </p>
              <p>
                You should not rely on DirtyDuty notifications for safety-critical or emergency
                obligations.
              </p>
              <p>You can manage supported notification preferences through the Service.</p>
            </TermsSection>

            <TermsSection title="8. Acceptable use">
              <p>You may not use DirtyDuty to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>violate applicable law</li>
                <li>impersonate another person</li>
                <li>harass, threaten or abuse others</li>
                <li>upload unlawful, harmful or infringing content</li>
                <li>gain unauthorized access to another account or household</li>
                <li>distribute malicious software or harmful code</li>
                <li>interfere with or disrupt the Service</li>
                <li>bypass security, authorization or access controls</li>
                <li>use automated systems to scrape, overload or abuse the Service</li>
                <li>
                  attempt to discover or exploit vulnerabilities except through authorized security
                  testing
                </li>
                <li>use DirtyDuty for fraudulent or deceptive activity</li>
              </ul>
              <p>
                We may restrict or suspend access when reasonably necessary to protect users, the
                Service or others.
              </p>
            </TermsSection>

            <TermsSection title="9. Privacy">
              <p>
                Your use of DirtyDuty may involve the collection and processing of personal
                information.
              </p>
              <p>
                Our Privacy Policy describes how personal information is collected, used, protected
                and retained.
              </p>
              <p>
                The Privacy Policy forms part of your relationship with DirtyDuty but does not
                replace these Terms.
              </p>
            </TermsSection>

            <TermsSection title="10. Third-party services">
              <p>
                DirtyDuty may rely on third-party services for functions such as authentication,
                hosting, infrastructure, email delivery or browser notifications.
              </p>
              <p>Those services may be governed by their own terms and privacy policies.</p>
              <p>
                We are not responsible for third-party services that are outside DirtyDuty&apos;s
                reasonable control.
              </p>
            </TermsSection>

            <TermsSection title="11. Availability and changes">
              <p>
                We aim to keep DirtyDuty available and reliable, but uninterrupted or error-free
                operation cannot be guaranteed.
              </p>
              <p>We may:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>maintain or update the Service</li>
                <li>add, modify or remove features</li>
                <li>temporarily suspend parts of the Service</li>
                <li>change technical requirements</li>
              </ul>
              <p>We will try to avoid unnecessary disruption where reasonably possible.</p>
              <p>Some features may be experimental or provided in beta form.</p>
            </TermsSection>

            <TermsSection title="12. Fees">
              <p>DirtyDuty is currently provided without a subscription fee.</p>
              <p>We may introduce optional paid features or plans in the future.</p>
              <p>
                You will not be charged for a new paid feature without being shown the applicable
                price and being given an opportunity to agree before the charge occurs.
              </p>
            </TermsSection>

            <TermsSection title="13. Suspension and termination">
              <p>You may stop using DirtyDuty at any time.</p>
              <p>We may suspend or terminate access if we reasonably believe that:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>these Terms have been materially violated</li>
                <li>an account creates a security risk</li>
                <li>the Service is being abused</li>
                <li>suspension is required by law</li>
                <li>continued access could harm DirtyDuty, its users or others</li>
              </ul>
              <p>Where appropriate, we will try to provide reasonable notice.</p>
            </TermsSection>

            <TermsSection title="14. Account and household deletion">
              <p>DirtyDuty provides supported methods for deleting accounts and households.</p>
              <p>
                Deleting an account or household may permanently remove associated information and
                may not be reversible.
              </p>
              <p>
                Some limited records may be retained when reasonably necessary for security, fraud
                prevention, legal compliance, dispute resolution or system integrity, subject to
                applicable law and our Privacy Policy.
              </p>
            </TermsSection>

            <TermsSection title="15. DirtyDuty intellectual property">
              <p>
                DirtyDuty, including its software, design, branding, logos and original content, is
                owned by or licensed to the operator of DirtyDuty and is protected by applicable
                intellectual property laws.
              </p>
              <p>
                These Terms do not transfer ownership of DirtyDuty or its intellectual property to
                you.
              </p>
              <p>
                You may use the Service only for its intended purposes in accordance with these
                Terms.
              </p>
            </TermsSection>

            <TermsSection title="16. Disclaimer">
              <p>
                DirtyDuty is provided on an &quot;as is&quot; and &quot;as available&quot; basis to
                the extent permitted by applicable law.
              </p>
              <p>
                We do not guarantee that the Service will always be available, uninterrupted,
                error-free or suitable for every purpose.
              </p>
              <p>
                Chore schedules, reminders and household information depend partly on information
                supplied by users and devices.
              </p>
              <p>
                Nothing in these Terms excludes warranties, consumer rights or other protections
                that cannot legally be excluded.
              </p>
            </TermsSection>

            <TermsSection title="17. Limitation of liability">
              <p>
                To the maximum extent permitted by applicable law, DirtyDuty and its operator will
                not be liable for indirect, incidental, special, consequential or punitive damages
                arising from your use of, or inability to use, the Service.
              </p>
              <p>
                To the maximum extent permitted by law, DirtyDuty&apos;s total aggregate liability
                relating to the Service will not exceed the greater of:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  the amount you paid to DirtyDuty during the 12 months before the event giving rise
                  to the claim, or
                </li>
                <li>CAD $100.</li>
              </ul>
              <p>
                Nothing in these Terms limits liability where doing so would be prohibited by law.
              </p>
            </TermsSection>

            <TermsSection title="18. Changes to these Terms">
              <p>
                We may update these Terms as DirtyDuty evolves or when legal or operational
                requirements change.
              </p>
              <p>
                If a change is material, we will take reasonable steps to provide notice through the
                Service or another appropriate method.
              </p>
              <p>The updated Terms will identify their effective date.</p>
              <p>
                Continuing to use DirtyDuty after updated Terms take effect means you agree to the
                updated Terms, except where additional consent is required by law.
              </p>
            </TermsSection>

            <TermsSection title="19. Governing law">
              <p>
                These Terms are governed by the laws of the Province of Nova Scotia and the
                applicable federal laws of Canada, without regard to conflict-of-law principles.
              </p>
              <p>
                Nothing in this section prevents you from relying on mandatory consumer protections
                or other rights that apply in your jurisdiction.
              </p>
            </TermsSection>

            <TermsSection title="20. Contact">
              <p>
                Questions about these Terms may be sent to the DirtyDuty support contact shown in
                the Service.
              </p>
              {supportEmail && (
                <p>
                  <a
                    className="font-semibold text-teal-700 underline underline-offset-2 dark:text-teal-300"
                    href={`mailto:${supportEmail}`}
                  >
                    {supportEmail}
                  </a>
                </p>
              )}
            </TermsSection>
          </div>
        </article>
      </main>
    </div>
  )
}
