# Security Policy

## Reporting

Please report security or privacy issues privately to the repository maintainer rather than opening a public issue with exploit details or sensitive sample images.

Include:

- affected browser and version;
- a concise reproduction using synthetic data;
- whether an outbound request, data persistence, metadata leak, or unintended export was observed.

Never attach a real identity document, private phone number, face photo, license plate, or other personal data.

## Threat Model

VEIL is designed to reduce accidental sharing of visible sensitive content in screenshots. It does not protect against:

- malicious browser extensions that can read page content;
- a compromised operating system, browser binary, or local model file;
- a modified fork that introduces a server endpoint;
- re-identification from unredacted context;
- a user exporting before completing manual review.

## Privacy Invariants

The upstream project intends to preserve these invariants:

1. No image upload endpoint or remote inference call.
2. Runtime assets are served from the same origin.
3. CSP limits network connections to `'self'`.
4. User images are not written to localStorage, IndexedDB, Cache Storage, or analytics.
5. Exported images are newly encoded from a Canvas.

Any pull request that weakens one of these invariants must be treated as a security and privacy change and documented explicitly.

## Supported Versions

Security and privacy fixes are applied to the latest version on the default branch.
