# SP Workshop Tracker - Admin app + Worker app

Files: admin.html (Admin PWA), worker.html (Worker PWA), index.html (link page), app.js (shared code), config.js (your Apps Script URL),
sw.js, manifest-admin.json, manifest-worker.json, icon-admin-*.png, icon-worker-*.png, Code.gs (backend).

## 1. Backend (Google)
1. script.google.com > New project > paste Code.gs > Save. Run `setup` once and allow permissions.
2. Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone. Copy the /exec URL.
   After every Code.gs change: Deploy > Manage deployments > Edit > New version.

## 2. Connect + host
1. Put the /exec URL in config.js.
2. Upload ALL files (except Code.gs/README, optional) to a GitHub repo, then Settings > Pages > main / root.
3. Admin phone: open https://USERNAME.github.io/REPO/admin.html > Add to Home Screen.
   Workers: open .../worker.html > Add to Home Screen. Each installs as its own app with its own icon.

## 3. First use
Open admin.html: create the Admin name + PIN. Admin > Team > add each worker with their own PIN.
Create jobs, assign a person per step. Per job (Admin): Print job card, WhatsApp status, Purchase orders (print/PDF or WhatsApp to supplier), private memo.
Lost Admin PIN: run `resetAdminPin` in the Apps Script editor (PIN becomes 0000).

## Notifications
When a worker sends a message, flags an issue or finishes a job, Admin also gets an **email** (to the Google account that owns the script), so it reaches your phone even when the app is closed. After updating Code.gs: run `setup` again and allow the new email permission, then Deploy > Manage deployments > Edit > New version.
Inside the app: Inbox tab with a red badge (also on the home-screen icon where supported). Open Inbox once and tap "Turn on alerts" for pop-ups while the app is open.

## WhatsApp alerts to Admin (optional, free via CallMeBot)
1. On the Admin phone (0778060860) follow https://www.callmebot.com/blog/free-api-whatsapp-messages/ : save the CallMeBot contact shown there and send it the activation message. It replies with an API key.
2. Apps Script > Project Settings > Script properties > Add `CALLMEBOT_KEY` = that key (optional `ADMIN_WHATSAPP` = +94778060860).
3. Run `testNotify` in the editor to test, then Deploy > Manage deployments > Edit > New version.
