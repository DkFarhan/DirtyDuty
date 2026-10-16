# Security Review: Phase 2 Authentication

## Finding 1 — SMTP STARTTLS was optional

- **Severity:** HIGH
- **Confidence:** 9/10
- **Status:** Resolved
- **Affected files:** [`backend/src/main/resources/application-prod.yaml`](backend/src/main/resources/application-prod.yaml), [`backend/src/main/resources/application.yaml`](backend/src/main/resources/application.yaml), [`backend/src/main/java/com/dirtyduty/app/config/AuthFeatureConfiguration.java`](backend/src/main/java/com/dirtyduty/app/config/AuthFeatureConfiguration.java), and [`backend/src/main/java/com/dirtyduty/app/service/SmtpPasswordResetMailer.java`](backend/src/main/java/com/dirtyduty/app/service/SmtpPasswordResetMailer.java)

SMTP STARTTLS is enabled but not required. When the mail server does not
advertise STARTTLS, JavaMail may continue without TLS. A network attacker could
then intercept password-reset messages and their bearer tokens; SMTP credentials
may also be exposed. Password-reset mail includes the token in its reset link.
Startup validation currently checks the STARTTLS enable flag, but does not
require TLS negotiation.

**Recommended remediation:** Set `mail.smtp.starttls.required=true` for
password-reset delivery. Both application profiles and Compose now default
`MAIL_STARTTLS_ENABLED`, `MAIL_STARTTLS_REQUIRED`, and
`MAIL_TLS_VERIFY_SERVER_IDENTITY` to `true`. Startup validation rejects
password-reset configurations without mandatory STARTTLS and server identity
verification, and rejects SMTP authentication without configured credentials.
The mail sender's runtime JavaMail properties are covered by an integration
test. Reset emails are dispatched after the database transaction commits, so
SMTP delivery time does not reveal whether an account exists; delivery failures
revoke the newly created token and are logged without SMTP exception details.

Local non-reset development does not require SMTP configuration. Real SMTP
certificate trust and delivery still require verification against the deployed
mail provider before enabling password reset in production.

## Finding 2 — Standard Google sign-in counted as fresh reauthentication

- **Severity:** HIGH
- **Confidence:** 8/10
- **Status:** Resolved
- **Affected files:** [`backend/src/main/java/com/dirtyduty/app/security/GoogleAuthenticationSuccessHandler.java`](backend/src/main/java/com/dirtyduty/app/security/GoogleAuthenticationSuccessHandler.java), [`backend/src/main/java/com/dirtyduty/app/controller/AuthController.java`](backend/src/main/java/com/dirtyduty/app/controller/AuthController.java), and [`backend/src/main/java/com/dirtyduty/app/service/RecentReauthenticationService.java`](backend/src/main/java/com/dirtyduty/app/service/RecentReauthenticationService.java)

An ordinary Google login set the same five-minute session marker used to
authorize sensitive actions for passwordless accounts. This meant that a
provider session sign-in could satisfy the reauthentication check without the
user explicitly starting the reauthentication flow.

The standard sign-in path now clears rather than sets the marker. Only the
explicit reauthentication flow sets it, and the marker remains time-limited and
single-use. Tests cover the distinction and consumption behavior.

## Finding 3 — ResponseStatusException was returned as an internal error

- **Severity:** LOW
- **Confidence:** 9/10
- **Status:** Resolved
- **Affected files:** [`backend/src/main/java/com/dirtyduty/app/exception/GlobalExceptionHandler.java`](backend/src/main/java/com/dirtyduty/app/exception/GlobalExceptionHandler.java)

Expired Google-link sessions and other intentional response-status failures
were caught by the generic exception handler and returned as HTTP 500. A
specific handler now preserves the intended HTTP status and safe reason for
these responses, avoiding internal-error logging for expected client failures.

## Finding 4 — Production Compose had a known database-password fallback

- **Severity:** HIGH
- **Confidence:** 9/10
- **Status:** Resolved
- **Affected files:** [`docker-compose.yml`](docker-compose.yml), [`backend/src/main/resources/application-prod.yaml`](backend/src/main/resources/application-prod.yaml), and [`.env.production.example`](.env.production.example)

If `POSTGRES_PASSWORD` was omitted, production Compose and the Spring production
profile both fell back to a known development password. Compose now requires
`POSTGRES_PASSWORD`, the production profile no longer supplies a password
default, and the example leaves the value empty so operators must set a unique
secret before starting the stack.
