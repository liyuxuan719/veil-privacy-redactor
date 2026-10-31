# Changelog

## 2.0.0 — 2026-11-01

### Added

- Local OCR email detection with an independent toggle, including plus tags and subdomains.
- Multiple QR detection through bounded, repeated jsQR passes on a private pixel copy (up to 20 codes per scan).
- Regression coverage for email rules, multi-QR scanning, image/scan races, and service worker cache isolation.

### Fixed

- Older image decodes no longer replace the most recently selected image.
- Scans capture their source image and category settings; obsolete scans cannot overwrite current results or clear a newer scan's busy state.
- OCR jobs are serialized on the shared worker; stale jobs and progress updates are discarded.
- Timed-out or partially initialized OCR workers are terminated, including workers that arrive after timeout.
- Region edits are locked during scanning to avoid losing edits when results arrive.
- Service worker activation removes only old VEIL caches, preserving other applications on the same origin.
- Offline navigation reads VEIL's own page cache; failed HTTP responses cannot replace cached pages and requests outside the app scope are ignored.

### Upgrade

- Existing display preferences remain compatible. Images and detection results remain in memory only.
- Email addresses outside common ASCII formats and QR images beyond the 20-code scan limit require manual review.
- Application code remains a static site; no accounts, credentials, tokens, or backend were added.
