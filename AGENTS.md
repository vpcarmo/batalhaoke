<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# BatalhaOkê — architecture rules

- Playback goes through `src/lib/playback` (PlaybackProvider + registry); never reference YouTube outside `youtube-*` files — so a licensed provider can replace it.
- Performances reference `playback_sources` (provider + external_id), never a raw video id — provider-independent data model.
- YouTube search runs only in the `youtubeSearch` server function (key in `YOUTUBE_API_KEY`), explicit-button only, max 8 results — quota economy and key secrecy.
- Only search metadata is cached (in-memory, 10 min); no media stored — YouTube policy compliance.
- Nothing is ever rendered over the provider player; attribution sits below it — YouTube RMF.
- Operator → TV sync uses Realtime (postgres_changes + broadcast `session-cmd:<id>`), no polling.
- MVP has no login: RLS open for sessions/participants/performances/playback_sources. votes/voter_sessions/controllers have no client policies; votes are written only by the `castVote` server fn (admin client) which resolves the active performance from `sessions.public_code` — client never picks the target.
- Public voting: one permanent QR per session (`/votar/<public_code>`); anonymous browser token, stored only as SHA-256(session_id:token) in `voter_sessions`; unique (performance_id, voter_session_id) — 1 like per device per performance.
- `performances.like_count` is maintained by a trigger on votes and protected from client edits; Realtime on performances delivers counts to TV/operator/voter.
- ESP32/controllers are out of the MVP flow; `controllers` table and `votes.controller_id` (now nullable) are kept for the future.
- Every YouTube API call is logged in `provider_api_calls` for quota tracking.
- X1 has two voting models (`sessions.x1_voting_mode`): `during_performance` uses the existing `votes` flow untouched; `after_both_performances` uses `x1_match_votes` only, opened atomically by a DB trigger when performance B completes and deadline-enforced by a DB trigger on `voting_ends_at` — so the server clock, not the client, is the authority.
- `x1_voting_mode` is locked by a DB trigger once a session has any match — the lock holds even though `sessions` RLS is open.
- Championship domain logic lives in server-only `src/lib/championship.server.ts` (privileged client injected); it is exposed only through `championship.functions.ts` wrappers that require `requireSupabaseAuth` and `assertVenueOperator` on the venue resolved server-side — never trust a client venue id.
- The Championship stage session is created in draft by `prepareStageSession` (idempotent via `sessions_championship_unique`) and started only by `activateStageSession`, which never ends another session and never changes the event status.
- Admin permissions come only from `venue_operators` (per-venue owner/operator, no global role, no client grants); there is no self-signup or bootstrap endpoint — operators are provisioned manually (docs/OPERATOR_PROVISIONING.md).
- `championships.format` is guarded by the `t_championship_format_guard` DB trigger (draft only, no entries) so the rule holds outside the admin UI.
- Login (`/login`) is only for Championship admin; Livre, X1, TV and public voting stay login-free.
