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
