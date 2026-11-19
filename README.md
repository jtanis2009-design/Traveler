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
- **Live map** of every bus, tram, metro and train around you (like LiveOV): line colours, direction arrows, filters for Bus / Metro / Tram / Train / *My lines*, and a button to show where you are
- **Track live**: tap any vehicle on the map, or the *Track live* button on a bus or metro in your journey, to follow it. It shows its route, every stop with live times, its delay, and when it reaches your stop

Vehicles with a solid outline are positioned from live data. A dashed outline means that operator isn't sending live data right now, so the position comes from the timetable. Zoomed out, vehicles become small dots (lighter = timetable only). Only Dutch public transport is shown (the Dutch OpenOV data, including international trains running in the Netherlands); foreign operators such as De Lijn, SNCB, Deutsche Bahn regional, FlixBus and BlaBlaCar are left out, and the map stays within the Netherlands.

The map draws all vehicles on a single canvas and unpacks the live data in a background thread, so it stays smooth on phones even with hundreds of vehicles on screen.

## Data

Journey planning and vehicle positions come from the free, open [Transitous](https://transitous.org) API (Dutch OpenOV timetable and live data). No API key needed. Positions are worked out from live departure and arrival times at each stop, so a vehicle moves smoothly between stops. The background map is the free official Dutch map [PDOK BRT-Achtergrondkaart](https://www.pdok.nl/) (Kadaster), no API key needed, drawn with [Leaflet](https://leafletjs.com).

## Putting it on your phone

It's a single static web page, so GitHub Pages can host it for free:

1. On GitHub, open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, pick the branch with these files and the `/ (root)` folder, and save.
3. After a minute it's live at `https://<your-username>.github.io/<repo-name>/`.
4. Open that link on your phone:
   - **iPhone (Safari):** Share → *Add to Home Screen*
   - **Android (Chrome):** ⋮ menu → *Add to Home screen* / *Install app*

To try it on a computer: run `python3 -m http.server` in this folder and open http://localhost:8000.
