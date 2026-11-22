# Security review (phase 6)

## Controls in place

| Area | Control |
|---|---|
| Authentication | bcrypt (cost 12) password hashes. Policy: at least 10 characters, with a letter and a digit. The login form responds in the same time whether or not the email exists, so accounts can't be discovered. 8 failed attempts lock that email for 15 minutes. Failures are audited. |
| Two-factor | TOTP (RFC 6238), optional per user, confirmed with a valid code before it takes effect. A separate 5-minute token covers the gap between password and code. Code attempts are throttled. Admins can reset a user's two-factor, which signs that user out. |
| Sessions | HS256 JWT in an `httpOnly` cookie with `SameSite=Lax` and `Secure` (in production), valid for 8 hours. Each token carries the user's `sessionVersion`. A password change, role change, deactivation, two-factor change or "Sign out of all devices" increments it, which revokes every existing session. |
| Authorization | A role × module × action matrix is checked in every server action and route handler, not just by hiding buttons. Page guards redirect users without access. The `proxy.ts` sign-in redirect is a convenience, not the security boundary. |
| CSRF | Server Actions check the request origin (built into Next.js). State-changing API routes are POST and authenticated (the ZIP route), or use a bearer secret (cron). |
| Financial integrity | Enforced in the database: the PO cap trigger, one valid invoice per milestone (partial unique index), the overpayment guard, payment status recalculated from payments, append-only audit and email logs, and CHECK constraints. Money is stored as fixed-precision decimals, never floating point. |
| Files | Stored privately outside `/public`, served only after an authorization check, with `nosniff` and `Cache-Control: private`. Uploads are type-checked by their content (magic bytes) against an allow-list and size-limited. Paths are confined to the storage root. File names are sanitized. |
| Output | React escapes rendered content. CSV exports block spreadsheet formulas. Email subjects have CR/LF removed so extra headers can't be injected. Success banners show only known messages. |
| Headers | CSP (`frame-ancestors 'self'`, `object-src 'none'`, `form-action 'self'`), HSTS in production, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. The `X-Powered-By` header is removed. |
| Audit | Material actions are written with actor, timestamp, before/after values and reason, and cannot be altered. |
| Secrets | `.env*` files are git- and docker-ignored. The SMTP password stays in the environment and is never stored in the database. |

## Known limitations / recommendations

- **CSP allows `'unsafe-inline'` scripts.** Next.js inlines its bootstrap scripts. To harden further, move to nonce-based CSP in `proxy.ts`.
- **Login throttling is in memory.** That works for a single server; with several instances, use a shared store such as Redis.
- **Two-factor is optional.** Policy recommendation: require it for Administrator and Finance accounts. Enforcement could be added as a setting.
- **No two-factor recovery codes.** Recovery is an admin reset, which is audited.
- **Dependency audit (2026-11-22, `npm audit --omit=dev`): 8 advisories, none reachable in this app as used.** Re-check before each release.
  - `prisma` → `@prisma/config` → `effect` (high, ReDoS in `Schema.TemplateLiteral`). This is the migration CLI; it never handles user input. Runtime queries go through `@prisma/client` and `@prisma/adapter-pg`, which aren't affected.
  - `archiver` → `readdir-glob` → `minimatch` (moderate, glob DoS). The app only appends in-memory buffers to the ZIP and never globs user-supplied patterns.
  - `exceljs` → `uuid` (moderate, bounds check in v3/v5/v6 when a buffer is passed). ExcelJS doesn't call it that way.
  - npm's suggested `--force` fixes are **downgrades** to older major versions, so they weren't applied. Upgrade when the maintainers release patched versions.
- **Rate limiting** beyond login (for example on exports) is left to the reverse proxy.
