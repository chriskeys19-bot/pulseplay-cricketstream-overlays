# Ground setup on YoloBox

Use this when a ground's video-ad picture and sound come from the external stream, and the web overlay only draws logos and the score.

The stream is one URL per ground:

- SRT: `srt://149.28.72.146:8890?streamid=read:<ground id>&latency=500`
- RTMP fallback: `rtmp://149.28.72.146/<ground id>`

Command Center shows both, plus the renderer URL, with a Copy button on each ground's card.

In admin, turn on **External video ad stream (SRT)** for that ground. While a video ad is on air the overlay page goes fully transparent (logos, score, and the match URL are hidden) so the keyed stream shows through. When the ad's length plus about 2.5 seconds has passed, the page returns to Logos + Score by itself. Image ads still play in the page. Leave the switch off and the page plays the video itself, as it does today.

Duplicate an existing ground when you are standing up the next field. That copies logos, layout, the ad set, the device, and the SRT switch into a new id and name. It does not copy score URLs. Set a new score URL, then change the age-group sponsor logo and the tournament logo if this game needs different ones. The score URL should be on `overlay.cricclubs.com`. Any other host is not allowlisted for embedding, and the form says so. Save ground writes only that ground. It leaves the on-air ad and the layout or SRT switch alone unless you changed them, or you unticked the ad that is on air. Score width, under Layout, narrows the bar from the center without shrinking the page the score is drawn on. That short bar is drawn at 2.15×. A `static.cricclubs.com` `ccindex.html` page is already full size, so the overlay leaves it at 1× and still uses the ground's score scale and nudge. When you save a score, tick **Full-size page** for a bar that is already drawn large, or leave it off for the compact overlay.cricclubs.com bar (including a short link that points there).

A ground that hosts two games in a day keeps both score URLs. On Ground controls, under Score overlay, save each one with a name (for example `Game 1 – U11 vs X` and `Game 2 – U13 vs Y`). One tap puts that score on air. Logos, ads, and layout stay as they are, and the overlay page swaps the score frame without reloading the logos.

## YoloBox Pro

1. Add an SRT source and paste that ground's SRT URL.
2. On the SRT source thumbnail, tap the person icon.
3. Turn on **Keying Switch**.
4. Set the key color to **Green** and the background to transparent.
5. Open **PIP Video**. Set **HDMI 1** as the main screen and the SRT source as the sub screen at full scale.
6. In the **Audio Mixer**, turn the SRT channel on.
7. Turn the web overlay on and load this ground's renderer URL (`renderer/pro.html?ground=<ground id>&device=pro` on the Pages site, or the short link that points there).

## YoloBox Mini

Placeholder. Fill this in after the Mini keying and PIP steps are confirmed.
