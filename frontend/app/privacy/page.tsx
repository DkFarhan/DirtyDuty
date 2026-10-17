import type { Metadata } from "next"
import { ProductLogo } from "@/components/brand/product-logo"
import { getSupportEmail } from "@/components/chore-sync/support-message"
import { LegalDocumentBackLink } from "@/components/chore-sync/legal-document-back-link"
import { LegalDocumentLink } from "@/components/chore-sync/legal-document-link"

export const metadata: Metadata = {
  title: "Privacy Policy | DirtyDuty",
  description: "Privacy Policy for DirtyDuty.",
}

function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `privacy-${title.split(" ")[0].replace(".", "")}`
  return (
    <section aria-labelledby={id} className="scroll-mt-6">
      <h2
        className="font-display text-lg font-extrabold leading-snug text-slate-900 dark:text-slate-100"
        id={id}
      >
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
        {children}
      </div>
    </section>
  )
}

function PolicySubheading({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-1 text-sm font-bold text-slate-800 dark:text-slate-200">{children}</h3>
}

function PolicyList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1 pl-5">{children}</ul>
}

export default function PrivacyPage() {
  const supportEmail = getSupportEmail()

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex min-h-16 max-w-4xl items-center justify-between gap-4 px-5 py-3">
          <LegalDocumentBackLink />
          <ProductLogo className="h-auto w-32 max-w-[45vw]" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
        <article className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-9">
          <header className="mb-8 border-b border-slate-100 pb-6 dark:border-slate-800">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">
              Privacy
            </p>
            <h1 className="mt-2 font-display text-3xl font-black leading-tight text-slate-900 dark:text-slate-100 sm:text-4xl">
              DirtyDuty Privacy Policy
            </h1>
            <p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">
              Effective date: October 17, 2026
            </p>
          </header>

          <section
            aria-labelledby="privacy-at-a-glance"
            className="mb-9 rounded-xl border border-teal-100 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-950/40 sm:p-5"
          >
            <h2
              className="font-display text-base font-extrabold text-slate-900 dark:text-slate-100"
              id="privacy-at-a-glance"
            >
              Privacy at a glance
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              <p>
                DirtyDuty is a household chore-management service. We collect only information
                reasonably needed to provide, secure and improve the Service.
              </p>
              <p>In particular:</p>
              <PolicyList>
                <li>We collect account information such as your name and email address.</li>
                <li>
                  We process household, chore, assignment and activity information that you and
                  other household members create.
                </li>
                <li>
                  Other members of a household may see information you share within that household,
                  including your display name, assignments and relevant chore activity.
                </li>
                <li>
                  If you enable notifications, we process the information necessary to deliver them.
                </li>
                <li>
                  We use service providers for functions such as authentication, hosting, email
                  delivery and browser push notifications.
                </li>
                <li>We do not sell your personal information.</li>
                <li>
                  We do not currently use your personal information for third-party behavioural
                  advertising.
                </li>
                <li>
                  You can request access to, correction of or deletion of your personal information,
                  subject to applicable legal and operational requirements.
                </li>
              </PolicyList>
              <p>The sections below explain these practices in more detail.</p>
            </div>
          </section>

          <div className="space-y-8">
            <PolicySection title="1. About this Privacy Policy">
              <p>
                This Privacy Policy explains how DirtyDuty collects, uses, discloses, stores and
                protects personal information when you use the DirtyDuty website, progressive web
                application and related services (the &quot;Service&quot;).
              </p>
              <p>DirtyDuty is operated from Nova Scotia, Canada.</p>
              <p>
                By using the Service, you acknowledge the privacy practices described in this
                Policy.
              </p>
              <p>
                Where consent is required by applicable law, DirtyDuty will seek consent appropriate
                to the nature and sensitivity of the information and the purpose for which it is
                collected, used or disclosed.
              </p>
            </PolicySection>

            <PolicySection title="2. Information we collect">
              <p>The information DirtyDuty collects depends on how you use the Service.</p>
              <PolicySubheading>Account information</PolicySubheading>
              <p>When you create or use an account, we may collect:</p>
              <PolicyList>
                <li>your display name</li>
                <li>your email address</li>
                <li>account status and account-related timestamps</li>
                <li>authentication-related information</li>
                <li>
                  records showing which versions of our{" "}
                  <LegalDocumentLink
                    className="font-semibold text-teal-700 underline dark:text-teal-300"
                    path="/terms"
                  >
                    Terms of Service
                  </LegalDocumentLink>{" "}
                  and Privacy Policy you accepted or acknowledged and when
                </li>
              </PolicyList>
              <p>
                If you create a password for DirtyDuty, we store a cryptographic password hash
                rather than your plain-text password.
              </p>
              <PolicySubheading>Google Sign-In information</PolicySubheading>
              <p>
                If you use Google Sign-In, DirtyDuty may receive basic identity information made
                available through Google&apos;s authentication service, such as:
              </p>
              <PolicyList>
                <li>your email address</li>
                <li>your name or profile information where provided</li>
                <li>
                  a stable Google account identifier used to associate your Google account with your
                  DirtyDuty account
                </li>
              </PolicyList>
              <p>DirtyDuty does not receive or store your Google password.</p>
              <PolicySubheading>Household information</PolicySubheading>
              <p>When you create or join a household, we may process information such as:</p>
              <PolicyList>
                <li>household name</li>
                <li>household description</li>
                <li>household membership</li>
                <li>member roles such as owner, administrator or member</li>
                <li>household invitations</li>
                <li>membership and role activity</li>
              </PolicyList>
              <PolicySubheading>Chore and activity information</PolicySubheading>
              <p>
                DirtyDuty processes information necessary to provide its chore-management features,
                including:
              </p>
              <PolicyList>
                <li>chore names and descriptions</li>
                <li>categories</li>
                <li>schedules and recurrence information</li>
                <li>assignments</li>
                <li>estimated durations</li>
                <li>completion records</li>
                <li>household activity relating to chores</li>
                <li>related status and history information</li>
              </PolicyList>
              <PolicySubheading>Notification information</PolicySubheading>
              <p>If you use notification features, we may process:</p>
              <PolicyList>
                <li>your notification preferences</li>
                <li>notification status and related delivery information</li>
                <li>
                  browser or device push-subscription information necessary to deliver web push
                  notifications, such as subscription endpoints and associated public cryptographic
                  keys
                </li>
              </PolicyList>
              <p>Push notifications require permission from your browser or device.</p>
              <PolicySubheading>Support and feedback information</PolicySubheading>
              <p>If you contact DirtyDuty for support or send feedback, we may receive:</p>
              <PolicyList>
                <li>your email address</li>
                <li>information you include in your message</li>
                <li>technical or diagnostic information you choose to provide</li>
                <li>communications relating to your support request</li>
              </PolicyList>
              <PolicySubheading>Technical and security information</PolicySubheading>
              <p>
                When you use DirtyDuty, the Service or its infrastructure may process technical
                information reasonably necessary for operation and security, such as:
              </p>
              <PolicyList>
                <li>session identifiers</li>
                <li>IP addresses</li>
                <li>browser and device information</li>
                <li>request timestamps</li>
                <li>security and rate-limiting information</li>
                <li>server and application logs</li>
                <li>authentication events</li>
              </PolicyList>
              <p>
                We use this information primarily to operate, protect, troubleshoot and secure
                DirtyDuty.
              </p>
            </PolicySection>

            <PolicySection title="3. Information we do not intentionally collect">
              <p>DirtyDuty&apos;s current Service does not require users to provide:</p>
              <PolicyList>
                <li>payment card information</li>
                <li>precise GPS location</li>
                <li>address-book contacts</li>
                <li>government identification</li>
                <li>health information</li>
              </PolicyList>
              <p>
                If DirtyDuty introduces functionality requiring materially different categories of
                personal information, this Policy and any required consent process will be updated.
              </p>
            </PolicySection>

            <PolicySection title="4. How we use personal information">
              <p>We may use personal information to:</p>
              <PolicyList>
                <li>create and maintain DirtyDuty accounts</li>
                <li>authenticate users</li>
                <li>support Google Sign-In and account linking</li>
                <li>provide household collaboration features</li>
                <li>create, assign, schedule and track chores</li>
                <li>display household membership and relevant household activity</li>
                <li>send requested or necessary notifications</li>
                <li>send password-reset and account-security communications</li>
                <li>respond to support requests and feedback</li>
                <li>prevent abuse, fraud and unauthorized access</li>
                <li>apply security controls and rate limits</li>
                <li>diagnose technical problems</li>
                <li>maintain the reliability and security of the Service</li>
                <li>
                  enforce our{" "}
                  <LegalDocumentLink
                    className="font-semibold text-teal-700 underline dark:text-teal-300"
                    path="/terms"
                  >
                    Terms of Service
                  </LegalDocumentLink>
                </li>
                <li>comply with applicable legal obligations</li>
                <li>protect DirtyDuty, our users and others</li>
              </PolicyList>
              <p>
                We do not use personal information for materially different purposes without
                providing appropriate notice and obtaining consent where required.
              </p>
            </PolicySection>

            <PolicySection title="5. Information visible to other household members">
              <p>DirtyDuty is designed for shared household use.</p>
              <p>
                When you join a household, other members of that household may be able to see
                information relevant to collaboration, including:
              </p>
              <PolicyList>
                <li>your display name</li>
                <li>your household role</li>
                <li>chores assigned to you</li>
                <li>chore completion information</li>
                <li>household activity associated with your account</li>
                <li>other information you intentionally share within the household</li>
              </PolicyList>
              <p>
                Household owners and administrators may have additional access or management
                capabilities as described in the Service and the Terms of Service.
              </p>
              <p>
                You should only join households containing people with whom you are comfortable
                sharing household-related information.
              </p>
            </PolicySection>

            <PolicySection title="6. How we share personal information">
              <p>DirtyDuty does not sell personal information.</p>
              <p>We may disclose personal information in the following circumstances.</p>
              <PolicySubheading>Other household members</PolicySubheading>
              <p>
                Information needed for household collaboration may be shared with other members of
                your household as described above.
              </p>
              <PolicySubheading>Service providers</PolicySubheading>
              <p>
                We may use service providers to operate parts of DirtyDuty, including services for:
              </p>
              <PolicyList>
                <li>cloud hosting and infrastructure</li>
                <li>authentication</li>
                <li>email delivery</li>
                <li>DNS or network services</li>
                <li>browser and device push notifications</li>
              </PolicyList>
              <p>
                These providers may process information on our behalf as necessary to provide their
                services.
              </p>
              <p>For example, DirtyDuty currently uses or is designed to use services such as:</p>
              <PolicyList>
                <li>Google for supported Google authentication</li>
                <li>Resend for transactional email delivery</li>
                <li>cloud infrastructure providers for application and database hosting</li>
                <li>
                  browser or operating-system push services when web push notifications are enabled
                </li>
              </PolicyList>
              <p>
                Service providers are subject to their own terms, privacy practices and security
                obligations.
              </p>
              <PolicySubheading>Legal and safety reasons</PolicySubheading>
              <p>We may disclose information where reasonably necessary to:</p>
              <PolicyList>
                <li>comply with applicable law, legal process or lawful government requests</li>
                <li>investigate fraud, abuse or security incidents</li>
                <li>protect the rights, safety or security of DirtyDuty, our users or others</li>
                <li>establish, exercise or defend legal claims</li>
              </PolicyList>
            </PolicySection>

            <PolicySection title="7. International processing">
              <p>
                Some service providers may process or store information outside your province or
                outside Canada.
              </p>
              <p>
                As a result, personal information may be subject to the laws of jurisdictions where
                a service provider operates and may be accessible to courts, law-enforcement
                agencies or regulatory authorities in those jurisdictions in accordance with
                applicable law.
              </p>
              <p>
                We remain responsible for personal information under our control and take reasonable
                steps to use service providers appropriate to the nature of the information and
                services involved.
              </p>
            </PolicySection>

            <PolicySection title="8. Cookies, sessions and local storage">
              <p>DirtyDuty uses technologies necessary to provide and secure the Service.</p>
              <PolicySubheading>Session cookies</PolicySubheading>
              <p>
                DirtyDuty uses session cookies or equivalent technologies to maintain authenticated
                sessions and help protect account access.
              </p>
              <p>
                Production authentication cookies are intended to use appropriate security
                protections such as secure transmission and restrictions on client-side script
                access where supported.
              </p>
              <PolicySubheading>Security mechanisms</PolicySubheading>
              <p>
                DirtyDuty may use browser and server mechanisms necessary for security, including
                protections against cross-site request forgery and unauthorized session use.
              </p>
              <PolicySubheading>Local storage</PolicySubheading>
              <p>
                DirtyDuty may use browser local storage for non-sensitive preferences, such as the
                user&apos;s Light, Dark or System appearance preference.
              </p>
              <p>
                DirtyDuty does not intentionally store your DirtyDuty password in browser local
                storage.
              </p>
              <PolicySubheading>Service worker and PWA functionality</PolicySubheading>
              <p>
                As a progressive web application, DirtyDuty may use a service worker and browser
                storage to support application loading, installation and notification functionality.
              </p>
            </PolicySection>

            <PolicySection title="9. Push notifications">
              <p>
                Push notifications are optional and require permission through your browser or
                device.
              </p>
              <p>
                If you enable them, DirtyDuty may store and process a push subscription associated
                with your browser or installed web application.
              </p>
              <p>
                Notification delivery may involve the push service operated by your browser, device
                or operating-system provider.
              </p>
              <p>
                You can disable notifications through DirtyDuty where supported or through your
                browser/device settings.
              </p>
              <p>
                Disabling push notifications does not prevent DirtyDuty from providing essential
                account or security communications through other available channels where necessary.
              </p>
            </PolicySection>

            <PolicySection title="10. Email communications">
              <p>DirtyDuty may send transactional email for purposes such as:</p>
              <PolicyList>
                <li>password resets</li>
                <li>account security</li>
                <li>account or Service administration</li>
                <li>other functionality you request</li>
              </PolicyList>
              <p>
                DirtyDuty does not currently use account email addresses for third-party
                advertising.
              </p>
              <p>
                If optional marketing communications are introduced in the future, they will be
                handled separately and any consent required by applicable law will be obtained.
              </p>
            </PolicySection>

            <PolicySection title="11. Passwords and authentication security">
              <p>
                For accounts using a DirtyDuty password, DirtyDuty stores a cryptographic password
                hash rather than the original password.
              </p>
              <p>
                Password-reset credentials are designed to be temporary, single-use and securely
                processed.
              </p>
              <p>
                Google authentication is handled using supported authentication protocols, and
                DirtyDuty does not receive your Google password.
              </p>
              <p>
                No method of electronic storage or transmission can guarantee absolute security, but
                DirtyDuty uses technical and organizational safeguards appropriate to the nature of
                the Service and information involved.
              </p>
            </PolicySection>

            <PolicySection title="12. Data retention">
              <p>
                DirtyDuty retains personal information only for as long as reasonably necessary for
                the purposes described in this Policy, including providing the Service, maintaining
                security, resolving disputes and satisfying applicable legal obligations.
              </p>
              <p>
                Retention periods may differ depending on the type of information and its purpose.
              </p>
              <p>
                When an account or household is deleted, associated information may be removed or
                scheduled for deletion in accordance with DirtyDuty&apos;s deletion processes.
              </p>
              <p>Limited information may be retained where reasonably necessary for:</p>
              <PolicyList>
                <li>security</li>
                <li>fraud prevention</li>
                <li>legal compliance</li>
                <li>dispute resolution</li>
                <li>enforcing agreements</li>
                <li>maintaining system integrity</li>
              </PolicyList>
              <p>
                Residual copies may also remain temporarily in backups or logs until they are
                overwritten or expire through normal retention cycles.
              </p>
            </PolicySection>

            <PolicySection title="13. Account and household deletion">
              <p>
                DirtyDuty provides supported methods for deleting accounts and households where the
                user has the necessary permissions.
              </p>
              <p>
                Account or household deletion may permanently remove associated information and may
                not be reversible.
              </p>
              <p>Deleting your account may also remove your access to household information.</p>
              <p>
                Information belonging to or required by other household members may be handled
                according to the structure of the household and applicable deletion rules.
              </p>
            </PolicySection>

            <PolicySection title="14. Security safeguards">
              <p>
                DirtyDuty uses safeguards intended to protect personal information against
                unauthorized access, use, alteration or disclosure.
              </p>
              <p>Depending on the context, these safeguards may include:</p>
              <PolicyList>
                <li>encrypted HTTPS connections in production</li>
                <li>securely hashed passwords</li>
                <li>secure session management</li>
                <li>access controls</li>
                <li>household authorization controls</li>
                <li>protections against unauthorized requests</li>
                <li>hashed or otherwise protected security tokens</li>
                <li>rate limiting</li>
                <li>database and infrastructure security controls</li>
                <li>security-oriented logging and monitoring</li>
                <li>restricted handling of application secrets</li>
              </PolicyList>
              <p>Security practices may evolve as the Service changes.</p>
              <p>
                If a privacy or security breach occurs, DirtyDuty will assess and respond to the
                incident and provide notifications where required by applicable law.
              </p>
            </PolicySection>

            <PolicySection title="15. Your choices">
              <p>Depending on the feature, you may be able to:</p>
              <PolicyList>
                <li>update account information</li>
                <li>manage notification preferences</li>
                <li>revoke browser push-notification permission</li>
                <li>leave a household</li>
                <li>delete a household where authorized</li>
                <li>delete your DirtyDuty account</li>
                <li>stop using the Service</li>
              </PolicyList>
              <p>You may also contact DirtyDuty regarding privacy-related questions or requests.</p>
              <p>
                Withdrawing consent or deleting information may affect our ability to provide some
                or all of the Service where that information is necessary for the requested
                functionality.
              </p>
            </PolicySection>

            <PolicySection title="16. Access and correction">
              <p>
                Depending on applicable law and the circumstances, you may have the right to request
                access to personal information DirtyDuty holds about you and request correction of
                information that is inaccurate or incomplete.
              </p>
              <p>
                To make a privacy-related access or correction request, contact the DirtyDuty
                privacy contact using the support information provided in the Service.
              </p>
              <p>We may need to verify your identity before responding to a request.</p>
              <p>
                Certain information may be withheld where permitted or required by applicable law.
              </p>
            </PolicySection>

            <PolicySection title="17. Children and minors">
              <p>
                DirtyDuty is not intended for children under 13 to independently create or operate
                accounts.
              </p>
              <p>
                If you are under the age of majority where you live, you should use DirtyDuty only
                with the permission and supervision of a parent or legal guardian.
              </p>
              <p>
                If we learn that personal information was collected from a child in circumstances
                where appropriate authorization was required but not obtained, we may take
                reasonable steps to delete or otherwise address that information.
              </p>
            </PolicySection>

            <PolicySection title="18. No sale of personal information or behavioural advertising">
              <p>DirtyDuty does not sell or rent users&apos; personal information.</p>
              <p>
                DirtyDuty does not currently use personal information to provide third-party
                behavioural advertising.
              </p>
              <p>
                If these practices materially change, we will update this Policy and obtain any
                consent required by applicable law before applying the new practice where necessary.
              </p>
            </PolicySection>

            <PolicySection title="19. Changes to this Privacy Policy">
              <p>
                We may update this Privacy Policy as DirtyDuty evolves or as legal, operational or
                security requirements change.
              </p>
              <p>The current Policy will display its effective date.</p>
              <p>
                If we make material changes to how personal information is collected, used or
                disclosed, we will take reasonable steps to provide notice and obtain additional
                consent or acknowledgement where required.
              </p>
              <p>
                Users may be required to acknowledge a new version of this Privacy Policy before
                continuing to use the Service.
              </p>
            </PolicySection>

            <PolicySection title="20. Privacy accountability and complaints">
              <p>DirtyDuty is responsible for personal information under its control.</p>
              <p>
                Privacy questions, access requests, correction requests or complaints should first
                be directed to the DirtyDuty privacy contact using the support contact shown in the
                Service.
              </p>
              <p>
                We will review privacy concerns and make reasonable efforts to respond
                appropriately.
              </p>
              <p>
                Depending on where you live and the law that applies, you may also have the right to
                contact an applicable privacy regulator.
              </p>
            </PolicySection>

            <PolicySection title="21. Contact us">
              <p>
                For questions about this Privacy Policy or DirtyDuty&apos;s privacy practices,
                contact the DirtyDuty support/privacy contact shown in the Service.
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
              <p>
                <LegalDocumentLink
                  className="font-semibold text-teal-700 underline dark:text-teal-300"
                  path="/terms"
                >
                  Terms of Service
                </LegalDocumentLink>
              </p>
            </PolicySection>
          </div>
        </article>
      </main>
    </div>
  )
}
