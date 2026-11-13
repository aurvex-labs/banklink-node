# Changelog

## 0.3.0 — 2026-11-13

- Add `BanklinkV2` for customer-held keys, encrypted profiles, sealed jobs and local result decryption. V2 requires an enabled organisation and an explicitly scoped live API key.
- One-off `profiles.syncOnce` uses a throwaway key and needs no saved customer seed.
- Add `onStatus` progress events, including bank-app approval deadlines and resends.
- Bundle crypto 0.2.1 with two pinned production worker roots; verify signed worker lists and tickets before releasing credentials.
- Add `FileVersionCache` via `@banklink/sdk/local`. The default export retains v1 compatibility and the 0.2.0 webhook helpers.
- CLI and MCP remain on hold: no executable, MCP export, or CLI/MCP build files are published.

## 0.2.0 — 2026-10-01

### Added
- `constructWebhookEvent()` and `verifyWebhookSignature()` to verify the
  `Banklink-Signature` header on webhook deliveries, with replay protection and
  support for both secrets during a rotation. `WebhookSignatureError` is thrown
  when verification fails.
- `redirectUrl` on `requests.createLink()` and `requests.createAccess()`.
- `OrgNotVerifiedError` (HTTP 403, `org_not_verified`), thrown when creating a
  live link or access request before your link profile is verified.
- `HostedRequest` now types `kind`, `name`, `redirect_url`, `completed_at`,
  `last_error` and `delivery_error`. New `WebhookEvent`, `WebhookEventType` and
  `RedirectStatus` types.

### Fixed
- API errors are parsed from the `{ error: { code, message } }` envelope. Error
  messages previously read `[object Object]` and every error's `code` was
  `api_error`; they now carry the API's message and code.

### Changed
- Live webhook URLs for link and access requests must be https on your verified
  domain (enforced by the API).

## 0.1.0

- Initial release: accounts, transactions, balances, bank linking, hosted link
  and access requests.
