# Dental Radiology Reporting Application

A local, clinician-operated reporting application for panoramic, periapical, bitewing, CBCT, hand/wrist, occlusal, TMJ, cephalometric, and other examinations. It provides authenticated patient records, protected radiograph storage, interactive permanent and mixed-dentition charts, modality-specific narrative reports, a seven-step reporting workflow, report preview, and branded server-generated A4 PDFs.

The application does not perform automated diagnosis, image analysis, clinical inference, or automatic recommendations.

## Requirements

- Node.js 24 or newer (the application uses Node's built-in SQLite module)
- pnpm 10+ or npm 10+
- A modern desktop or tablet browser

## Fastest way to run on Windows

Double-click `Start Clinic App.cmd`. It installs missing dependencies when needed, starts the protected local server, and opens the application in the default browser.

On the first screen, create the administrator account. This one-time setup route works only from the same computer and disappears permanently after the first account is created. Public self-registration is never enabled.

After setup, Clinic settings opens automatically so the bundled original clinic logo and identity can be confirmed or updated.

## Command-line setup

The in-app setup above is recommended. For unattended or scripted setup, copy `.env.example` to `.env` and set a unique administrator username and password of at least 12 characters:

   ```text
   INITIAL_ADMIN_USERNAME=your-admin-name
   INITIAL_ADMIN_PASSWORD=use-a-long-unique-password
   ```

Then install and start:

   ```powershell
   pnpm install
   pnpm start
   ```

Open `http://127.0.0.1:4173` and sign in with the values used above. The supplied original clinic logo is bundled and appears on the login page, application header, settings and generated PDFs. Clinic settings can replace it with another PNG or JPEG without cropping or redrawing.

The first account is stored with a salted `scrypt` password hash. Later startups ignore bootstrap variables once an account exists. Do not commit `.env`.

`Start Clinic App.cmd` verifies Node.js 24+, installs missing dependencies, detects an already-running local instance, waits for the health endpoint, and opens the browser only after the server is ready.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `INITIAL_ADMIN_USERNAME` | First start only | Creates the first administrator account. |
| `INITIAL_ADMIN_PASSWORD` | First start only | Creates the first administrator account; minimum 12 characters. |
| `PORT` | No | HTTP port; default `4173`. |
| `HOST` | No | Bind address; default `127.0.0.1`. |
| `SESSION_HOURS` | No | Authenticated session lifetime; default `12`, range 1-72. |
| `DATA_DIR` | No | SQLite storage directory; default `./data`. |
| `UPLOADS_DIR` | No | Protected radiograph directory; default `./uploads/radiographs`. |
| `BRANDING_DIR` | No | Clinic logo directory; default `./uploads/branding`. |
| `NODE_ENV` | No | Set to `production` behind HTTPS to enable secure cookies. |

## Daily workflow

1. Sign in and create a new examination or search saved records by patient/file number, status, and date.
2. Complete patient identity, birth date/age, sex, telephone, referral and examination details.
3. Record medical and dental history, medications, allergies, surgery, symptoms, comparison imaging and common medical factors.
4. Select one or more examination modalities and document Right, Left, Bilateral, Midline, or Not applicable for each.
5. For Panoramic, Periapical, and Bitewing examinations, select a finding and click its teeth on the four-quadrant SVG dental chart. Permanent teeth are shown as local numbers 1–8 in every quadrant and primary teeth use A–E. M, D, O, B, L, P, I, Apical, and General surfaces appear only for **Enamel caries** and **Dentinal caries**; all other dental findings are tooth-specific without surface controls.
6. For CBCT, Hand/Wrist, Occlusal, TMJ, Cephalometric, or Other, open its report tab and complete the modality-specific manual report. Findings and Impression/Conclusion are required for final output. Hand/Wrist also includes a dedicated skeletal/bone-age assessment.
7. Upload protected images to their modality tabs, use thumbnails, zoom, pan, fit and reset, then review completeness grouped by modality.
8. Preview or download an independent branded CBCT/Hand-Wrist/other manual report, or create the combined **Diagnostic Imaging Report**. Every PDF uses the configured clinic logo and letterhead, modality schematics, page numbering, and automatic omission of empty sections.

Radiographs are excluded from PDFs by default. Enable **Include radiographs in PDF** to append protected image pages after the compact report.

## Storage and security

- Patient data, clinical state, sessions, and clinic settings are stored in `data/clinic.sqlite`.
- Uploaded radiographs are stored under `uploads/radiographs` with random server filenames.
- Neither patient records nor images are stored in browser `localStorage`.
- Radiographs are never exposed as public static files; every image request verifies the authenticated record owner.
- Session cookies are HTTP-only and SameSite Strict. Login attempts are rate-limited in process.
- Content security, MIME sniffing, referrer, and browser-permission headers are enabled.
- Uploaded PNG/JPEG files are checked by server-side signatures in addition to browser MIME and size validation.
- State-changing API calls reject mismatched browser origins.

For network or production use, run behind an HTTPS reverse proxy, set `NODE_ENV=production`, restrict access to the clinic network/VPN, use encrypted disks, back up both `data/` and `uploads/`, and follow applicable patient-data retention and access-control requirements. The included single-administrator bootstrap is intended for a small clinic deployment; add managed identity and audit logging before a multi-clinician or internet-facing deployment.

## Backup and restore

1. Stop the application so the SQLite database is not being modified.
2. Copy the complete `data/` and `uploads/` directories to encrypted backup media. Keep both directories from the same backup time together.
3. To restore, stop the application, preserve the current directories under a different name, then copy the backed-up `data/` and `uploads/` directories back beside `server/`.
4. Start the application and verify a known draft, its images, clinic settings and a PDF preview before resuming clinical work.

Custom paths configured through `DATA_DIR`, `UPLOADS_DIR`, or `BRANDING_DIR` must be backed up and restored at those locations instead.

## Clinic identity

Open **Clinic settings** after sign-in to update clinician name, professional title, center descriptor, address, telephone, email, medical registration number, website, report footer, or logo. The bundled original logo remains the fallback and is never cropped or redrawn.

## Troubleshooting

- **The launcher says Node.js is too old:** install Node.js 24 or newer and run the launcher again.
- **Port 4173 is already in use:** if the clinic app is already running, the launcher opens it. Otherwise stop the conflicting local process or start from a terminal with another `PORT` value.
- **An image is rejected:** use an actual PNG or JPEG under 25 MB; changing only the filename extension is not sufficient.
- **The browser reports an expired session:** sign in again. Drafts already saved to SQLite are retained.
- **The PDF omits a section:** empty sections are intentionally omitted. Reopen the draft and enter the relevant clinical content.

## Validation and tests

Run:

```powershell
pnpm run check
pnpm test
```

The automated checks cover dental/manual finalization rules, legacy-state normalization, the complete modality and side catalogue, caries-only surface superscripts, independent CBCT and Hand/Wrist reports, skeletal assessment, finding-specific tooth isolation, independent primary/permanent identifiers, side labels, conditional descriptions, and modality de-duplication. Browser verification uses synthetic patient data and exercises authentication, mixed dental/CBCT/Hand-Wrist tabs, caries-only surfaces, manual report persistence, modality-grouped review, PDF preview, four real A4 PDF variants, and unauthenticated-route rejection.

## Resetting the local test installation

Stop the server, back up anything needed, then remove `data/` and `uploads/`. On the next start, the application creates a new database and shows the loopback-only first-run administrator setup (or accepts the optional bootstrap environment variables). This permanently deletes local patient data and images, so do not do it on a clinic installation without a verified backup.
