# Security Review: Phase 2 Authentication

## Finding 1 — SMTP STARTTLS is optional

- **Severity:** HIGH
- **Confidence:** 9/10
- **Status:** Open
- **Affected files:** [`backend/src/main/resources/application-prod.yaml`](backend/src/main/resources/application-prod.yaml), [`backend/src/main/resources/application.yaml`](backend/src/main/resources/application.yaml), [`backend/src/main/java/com/dirtyduty/app/config/AuthFeatureConfiguration.java`](backend/src/main/java/com/dirtyduty/app/config/AuthFeatureConfiguration.java), and [`backend/src/main/java/com/dirtyduty/app/service/SmtpPasswordResetMailer.java`](backend/src/main/java/com/dirtyduty/app/service/SmtpPasswordResetMailer.java)

SMTP STARTTLS is enabled but not required. When the mail server does not
advertise STARTTLS, JavaMail may continue without TLS. A network attacker could
then intercept password-reset messages and their bearer tokens; SMTP credentials
may also be exposed. Password-reset mail includes the token in its reset link.
Startup validation currently checks the STARTTLS enable flag, but does not
require TLS negotiation.

**Recommended remediation:** Set `mail.smtp.starttls.required=true` for
production password-reset delivery and fail closed if TLS cannot be negotiated.
Also require SMTP server identity verification
(`mail.smtp.ssl.checkserveridentity=true`).

No remediation was applied in this review; the finding remains open.
