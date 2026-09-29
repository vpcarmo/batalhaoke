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

# Karaoke Arena — architecture rules

- Playback goes through `src/lib/playback` (PlaybackProvider + registry); never reference YouTube outside `youtube-*` files — so a licensed provider can replace it.
- Performances reference `playback_sources` (provider + external_id), never a raw video id — provider-independent data model.
- YouTube search runs only in the `youtubeSearch` server function (key in `YOUTUBE_API_KEY`), explicit-button only, max 8 results — quota economy and key secrecy.
- Only search metadata is cached (in-memory, 10 min); no media stored — YouTube policy compliance.
- Nothing is ever rendered over the provider player; attribution sits below it — YouTube RMF.
- Operator → TV sync uses Realtime (postgres_changes + broadcast `session-cmd:<id>`), no polling.
- MVP has no login: RLS policies are open for sessions/participants/performances/playback_sources; controllers/votes have no client policies (ESP32 phase will write via server API). Replace with auth-scoped policies when login is added.
- Every YouTube API call is logged in `provider_api_calls` for quota tracking.
