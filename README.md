# Tiffin Tracker

A simple, offline-first React app to track daily tiffin orders, missed days, and payments — with login via ID+PIN, screenshot evidence, and full local persistence. Built with zero build tooling (React via CDN).

Author: Gurinder Batth

## Features
- Daily calendar with per-day stats (orders, paid count, missed flag)
- Add multiple orders on the same day (title, quantity, notes)
- Mark individual orders as paid or bulk pay:
  - Select specific calendar dates via checkboxes, upload a single screenshot, and mark all unpaid orders on those dates as paid
- Upload payment screenshot evidence (stored in IndexedDB)
- Mark a day as "missed"
- Login with unique ID + PIN (salted+hashed) stored locally
- Light/Dark theme toggle with persistent preference
- Mobile-responsive layout
- 100% local data: IndexedDB + localStorage + sessionStorage

## Quick start
1. Serve the folder locally (any static server):
   - Python 3:
     ```bash
     python3 -m http.server 5500
     ```
   - Node (http-server):
     ```bash
     npx http-server -p 5500
     ```
2. Open `http://localhost:5500/` in your browser.
3. On first load, register your ID and PIN. Next time, login with the same ID+PIN on this device.

## How to use
- Calendar
  - Click a day to open details
  - On days with orders, you’ll see a small checkbox in the date header — use these to select dates for bulk pay
- Add orders
  - In day details, set item, quantity, and optional notes, then click "Add order"
- Mark as paid
  - Single: use the "Mark Paid" button on an order
  - Multiple on same day: select the order checkboxes and upload a screenshot
  - Multiple across dates: select the date checkboxes in the calendar, click "Bulk Pay (N)", upload one screenshot to mark all unpaid orders across selected dates
- Missed day
  - Toggle "Mark day as missed" in day details (even with zero orders)
- Theme
  - Use the header toggle to switch Light/Dark mode (saved in localStorage)

## Data & security
- Storage
  - Orders and day flags in IndexedDB
  - Payment screenshots in IndexedDB (as Blobs)
  - User (ID, salt, hashed PIN) in localStorage; session in sessionStorage
- PIN
  - PIN is never stored raw. It’s salted and hashed (SHA-256) in the browser.
- Privacy
  - All data stays on your device. There is no backend.

## Tech stack
- React 18 (UMD via CDN)
- IndexedDB (vanilla)
- LocalStorage/SessionStorage
- Plain CSS with CSS variables and responsive media queries

## Project structure
```
.
├─ index.html     # App shell (React via CDN, script includes)
├─ styles.css     # Theming, layout, calendar, responsive styles
└─ app.jsx        # All app logic and React components
```

## Deploy (GitHub Pages)
1. Commit this folder to a Git repo.
2. Push to GitHub.
3. Enable Pages (Settings → Pages) and select the branch + root.
4. Or publish from `docs/` by moving files into `docs/` and setting Pages to `docs`.

Tip: If you need a custom domain, add a `CNAME` file per GitHub Pages docs.

## Browser support
- Recent versions of Chrome, Edge, Firefox, and Safari should work
- IndexedDB and Blob URL support required (widely available in modern browsers)

## Notes & limitations
- Data is device-local. To migrate, use the same browser profile or add an export/import feature (can be added later).
- Screenshots are stored in-browser; clearing site data will remove them.

## Credits
- Built by Gurinder Batth
