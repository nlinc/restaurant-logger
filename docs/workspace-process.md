# lincoln-eats engineering and release process

Read AGENTS.md and its required app contract, then the shared Miles workflow.
The owner describes the outcome; Miles owns scope, reservations, implementation,
verification and a concise source-bound handoff. Existing paused/private scopes
remain separate. Test/commit/publish/deploy/acceptance are distinct claims.

## Actual gate

`node scripts/hosting-release.mjs gate` runs the declared structured commands in
`.release-policy.json`, including genuine release-boundary regression tests.
These preserve the app's existing checks; syntax/packaging tests do not prove
authenticated behavior, provider calls, phone usability or offline recovery.
Apply manual/emulator/device checks from AGENTS.md when their runtime scope changes.

## Release with exact identity

With a clean committed release input, choose a **new** output directory:

```sh
node scripts/hosting-release.mjs candidate /private/tmp/lincoln-eats-release-UNIQUE FULL_INTENDED_SHA
node scripts/hosting-release.mjs check /private/tmp/lincoln-eats-release-UNIQUE FULL_INTENDED_SHA
# Only during an owner-authorized rollout, with the intended downloaded/prepared artifact:
node scripts/hosting-release.mjs verify-url /private/tmp/lincoln-eats-release-UNIQUE FULL_INTENDED_SHA https://lincoln-eats-77229.web.app/
```

Candidate preparation runs the actual gate and stops on failure before artifact
creation. It reads only committed, explicitly listed runtime assets from Git,
requires HEAD/full revision and clean release inputs, preserves existing cache/
version/refresh behavior, and emits Hosting-only configuration plus full SHA and
asset hashes. Existing short stamp substitutions are retained where applicable.
The legacy app version and service-worker cache are not replaced with a SHA.

Deploy from a fresh copy of the checked artifact so Firebase CLI metadata never
changes the trusted expected directory. Use the copied artifact's firebase.json
and Hosting-only scope; Functions/rules/indexes need their own applicable gate
and release authority. Never deploy the repository root or include private files.
Served verification compares every intended asset and the canonical root HTML;
redirects, wrong/missing/stale assets and oversized responses fail. A cancellable
45second read-only visibility observation never repeats deployment or relaxes hashes.

## Real traps enforced

- A green version marker cannot conceal stale JS/CSS/SW bytes.
- Hidden staging directories require explicit inclusion in GitHub artifact uploads.
- Firebase writes local metadata: deploy a fresh copy and keep expected bytes immutable.
- Firebase canonicalizes index.html: compare intended HTML at the root without following arbitrary redirects.
- Do not treat local app data, absent values, private credentials or operational exports as source.
- Task IDs correlate records; they grant no authority and do not imply a worker is running.

No cloud backend/provider/user-data operations are part of routine process checks.
Source recovery and private/user data recovery remain separate; use the shared
recovery matrix and existing app-specific export/restore procedures.
