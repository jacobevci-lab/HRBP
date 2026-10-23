# Unified HR-service conversation and message composer

The existing conversation dialog now includes a message composer on the latest
verified page of a non-terminal request. Staff choose requester-visible reply or
private HR note; employees/managers can send requester-visible replies only.
The existing comment POST, relationship authorization and displayed-revision
checks are reused without any server, schema or permission changes.

## Interaction and privacy

- Opening and history paging remain GET-only. Sending is explicit and confirmed.
  Switching a nonempty private-note draft to public also requires confirmation.
- The composer uses the revision of the page actually read. A newer read cannot
  silently rebind an unsent draft: the user must review that page and explicitly
  choose `Use reviewed conversation`. Older pages are read-only for composition.
- Each response must match actor, tenant, request, message text, visibility and
  the expected/result revisions before the form clears its draft. Unknown,
  denied, stale and rejected responses never automatically resubmit.
- A successful result remains guarded until an explicit latest-page read shows
  the exact resulting revision and saved own-message ID/visibility. Only then
  `Prepare another message` clears the confirmed guard, without sending a POST.
  An unrelated newer revision, absent message or unknown result cannot rearm it.
- The composer remains mounted across close/open and reads to preserve outcome
  guards. Closing hides its draft; reopening for the same principal retains it.
  Switching actor, role, tenant or request (or losing verified session) clears
  draft text and the single saved-message proof; the bounded outcome map remains
  in the shared action hook. No draft is stored in local/session storage.
- Failed reads remove history and the composer until a fresh explicit read.
  A POST authorization denial invalidates the previously displayed history too.
- Native programmatic close events are accounted for per dialog element, so a
  queued event from a previous opening cannot cancel a new explicit opening.

## Compatibility and limits

The old action forms and read API envelope remain available. No endpoint changes,
automatic notification acknowledgement, write retry, polling or read-on-send is
introduced. A refresh is explicit; successful saves may invoke the shared hook's
existing best-effort router refresh. That refresh is not accepted as verification
of the new conversation page.

This is not cross-device durable idempotency. A full reload/unmount discards local
text/guards, and the server still requires the displayed version. A deliberate
new message may have identical text after a reviewed revision. A GET snapshot is
not instantaneous permission revocation and previously viewed content cannot be
recalled. Attachments, delivery confirmation, broad browser certification and
customer UAT are separate scope.

Verification: new actual-component tests exercise controlled hook/transport
counterparts. The new `hr-service-conversation-compose-browser.mjs` defines 20
production Next.js / Chromium / disposable PostgreSQL scenarios, added alongside
all existing suites in UI Deep Inspection. Do not call those scenarios successful
without exact-head CI evidence.
