# YouTube broadcast controls

Pulse Play admins open **Broadcasts** on the overlay admin page to list every live broadcast on the CricketCrazeUSA channel, test the connection, and start or end a broadcast. Ground controls, ads, and the overlay pages are unchanged.

Times on each row are Pacific (`America/Los_Angeles`), with Central (`America/Chicago`) beside them. Rows are grouped by the Pacific day.

Start asks for confirmation only when it is more than 15 minutes before the scheduled start. That dialog names the game, the Pacific and Central times, and the stream key. End always asks, and the dialog names the game. The buttons stay disabled while a request is in flight.

A matched `game_streams` row is marked `ended` only after YouTube confirms the broadcast is complete. A broadcast that goes live does not overwrite a setup step the club bot still owns.

## Who can use it

The overlay admin already signs in with Supabase Auth (Google or email and password). The dashboard opens only when `profiles.role` is `admin`. The YouTube functions use that same check. A captain, a pending account, and a signed-out visitor cannot list, start, or end broadcasts, and only an admin can press Connect.

## Google Cloud

The OAuth client already exists. Do not commit `YT_OAUTH_CLIENT_ID` or `YT_OAUTH_CLIENT_SECRET`.

| Setting | Value |
| --- | --- |
| Google Cloud project | `cheetahs-youtube-controls` |
| YouTube Data API v3 | Enable it on that project (APIs & Services → Library → YouTube Data API v3) |
| OAuth client type | Web application |
| Authorized JavaScript origin | `https://chriskeys19-bot.github.io` |
| Authorized redirect URI | `https://lutcbvzunjcosncvdyke.supabase.co/functions/v1/youtube-oauth-callback` |
| Scope | `https://www.googleapis.com/auth/youtube` |
| App homepage | `https://chriskeys19-bot.github.io/pulseplay-cricketstream-overlays/` |
| Privacy policy | `https://chriskeys19-bot.github.io/pulseplay-cricketstream-overlays/privacy.html` |
| Terms of service | `https://chriskeys19-bot.github.io/pulseplay-cricketstream-overlays/terms.html` |

The redirect URI is the Edge Function, not the admin page. Do not register `admin.html` as a Google redirect URI. After Google returns the code, the function sends the browser to the Broadcasts tab.

### Consent screen and the 7-day token

1. Open the consent screen for project `cheetahs-youtube-controls`.
2. User type: External.
3. Add the homepage, privacy policy, and terms URLs above.
4. Add the scope `https://www.googleapis.com/auth/youtube`. This scope is sensitive.
5. While the publishing status is **Testing**, add `cricketcrazeusa@gmail.com` as a test user. Google expires refresh tokens from a Testing app after 7 days.
6. Publish the app to **Production**. That stops the 7-day expiry. Until Google finishes any verification review, an admin may see an unverified-app warning and can continue. The Broadcasts tab shows a reconnect message when a token is expired or revoked. Revoke access any time at `https://myaccount.google.com/permissions`.

Connect from a Pulse Play admin account and choose the Google account `cricketcrazeusa@gmail.com` so the channel is CricketCrazeUSA.

## Supabase

Project `lutcbvzunjcosncvdyke`. GitHub Pages does not run SQL or deploy functions. Apply this migration. Do not also apply `cheetahs-club`'s `20261122120000_youtube_broadcast_oauth.sql`; that pull request stays closed. This file creates the same service-role-only tables. `CREATE TABLE IF NOT EXISTS` and `CREATE OR REPLACE` keep a second run from colliding.

1. Apply `supabase/migrations/20261122060000_pulseplay_youtube_broadcast_oauth.sql`.
2. Set Edge Function secrets (do not commit them):
   - `YT_OAUTH_CLIENT_ID`
   - `YT_OAUTH_CLIENT_SECRET`
3. Deploy:
   - `youtube-oauth-start` (`verify_jwt` on)
   - `youtube-oauth-callback` (`verify_jwt` off — Google’s redirect has no Supabase JWT)
   - `youtube-broadcasts` (`verify_jwt` on)

`supabase/config.toml` records those flags. If a deploy ignores the file, publish the callback with JWT verification disabled. The callback still requires a signed, 10-minute, single-use `state` value tied to the admin who pressed Connect.

The refresh token is stored in `private.youtube_connections`. Row level security is forced on, there is no policy for signed-in users, and the read function is granted only to `service_role`. The browser receives the channel name and connection status, never the token.

## Check that it works

1. Sign in as a Pulse Play admin and open Broadcasts.
2. Press Connect YouTube and accept the consent screen with `cricketcrazeusa@gmail.com`.
3. The page should say it is connected as CricketCrazeUSA.
4. Press **Test connection**. It calls `liveBroadcasts.list` and does not start or end anything.
5. Use **Today & upcoming**. Rows show Pacific and Central times, the full `https://www.youtube.com/watch?v=…` address, and a stream key name when YouTube or a `game_streams` row has one.
6. Press Start only after the encoder is already sending video. If YouTube is not receiving video, the button returns an error and does not change the broadcast. Auto-start off means Start must move the broadcast through testing and then to live.
7. End always asks for confirmation.

Do not start a real match broadcast while testing the button. Test connection is the safe check.
