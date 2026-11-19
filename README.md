# Traveler

My own little journey planner for the trips I make all the time. It shows the next departures with live delays, so I don't have to look them up in a planner app every day.

Saved trips (both work in either direction):

- Middelharnis, Gemeentehuis ⇄ Grafisch Lyceum Rotterdam
- Oude-Tonge, Busstation ⇄ Grafisch Lyceum Rotterdam

Before 13:00 it shows the trip to school, after 13:00 the trip home. The swap button flips it.

## Features

- Next 5 connections with countdown to when you have to leave, refreshed every minute
- Live delays, cancellations and service notices (bus 436, RET metro, etc.)
- Tap a connection to see every stop, platform and walking part
- "Depart at" and "Arrive by" (defaults to arriving by 08:30)
- Add your own trips with place search; they're saved on your phone
- Installable on your home screen, works like an app

## Data

Journey planning comes from the free, open [Transitous](https://transitous.org) API (Dutch OpenOV timetable and live data). No API key needed.

## Putting it on your phone

It's a single static web page, so GitHub Pages can host it for free:

1. On GitHub, open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, pick the branch with these files and the `/ (root)` folder, and save.
3. After a minute it's live at `https://<your-username>.github.io/<repo-name>/`.
4. Open that link on your phone:
   - **iPhone (Safari):** Share → *Add to Home Screen*
   - **Android (Chrome):** ⋮ menu → *Add to Home screen* / *Install app*

To try it on a computer: run `python3 -m http.server` in this folder and open http://localhost:8000.
