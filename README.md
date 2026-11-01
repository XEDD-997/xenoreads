# Xenoreads

A private audiobook app for your own listening: classics read by real people (LibriVox), any other public-domain book or article narrated by an AI voice (Kokoro), offline downloads, bookmarks, and a read-along screen that follows the voice sentence by sentence, like lyrics in a music app.

- **Web app** on Firebase Hosting: install it on iPhone, Android or PC from the browser. Streams only.
- **Android app** (APK) built automatically by GitHub Actions, with offline downloads, lock-screen controls, background playback and a 120 Hz display mode.

**Completely free, no card needed.** Firebase's free Spark plan holds your account, library, progress, bookmarks and read-along text, and hosts the website. Narrated audio is published to your GitHub repo's Releases, which are free with no size cap.
- **Narrator** that turns books and articles into audio with synced text. It runs on GitHub Actions, or on your PC when your free minutes run out.

Day theme is cream paper with navy ink; Night theme is navy. Auto follows your phone.

---

## Setup (about 15 minutes, once)

Use your personal Google account for Firebase, and your GitHub account `XEDD-997`.

### 1. Firebase project

1. Go to <https://console.firebase.google.com>, choose **Create a project**, name it `xenoreads`. Google Analytics isn't needed.
2. Stay on the free **Spark** plan. Don't upgrade, and skip *Storage*; the app doesn't use it.
3. **Authentication** → *Get started* → enable **Email/Password**. Then *Users* → **Add user** with your email and a password. This is the only account that can open the app.
   Then lock sign-ups: *Authentication* → *Settings* → *User actions* → untick **Enable create (sign-up)** and save. Also turn on **Email enumeration protection** on the same page. Now nobody can create an account, and the security rules only let your email read or write anything.
4. **Firestore Database** → *Create database* → **production mode** → location **asia-south1 (Mumbai)**, closest to the Maldives.
5. **Project settings** (gear icon) → *General* → *Your apps* → the web icon `</>` → nickname `Xenoreads` → **Register app**. Copy the `firebaseConfig = { ... }` block that appears.
6. **Project settings** → *Service accounts* → **Generate new private key**. A `.json` file downloads. Keep it private.
7. Give that service account permission to deploy: open <https://console.cloud.google.com/iam-admin/iam>, pick the `xenoreads` project, click the pencil next to `firebase-adminsdk-…@…iam.gserviceaccount.com` and **add roles** `Firebase Admin` and `Service Usage Consumer`. Save.

### 2. GitHub repository and secrets

1. Create a **public** repository named `xenoreads` (it already contains this code if Claude pushed it for you).
   - It must be public so the app can stream the narrated audio from its Releases, and public repos get unlimited free Actions minutes for narration.
   - Your secrets, Firebase data, library and bookmarks stay private. What's public is the code and the narrated audio files: public-domain books are fine; an article you narrate in HD becomes a downloadable file there too, so use the device voice for anything you'd rather not publish.
2. Repository → *Settings* → *Secrets and variables* → *Actions* → **New repository secret**, five times:

| Secret | Value |
|---|---|
| `FIREBASE_CONFIG` | The `firebaseConfig = { ... }` block from step 1.5, pasted as-is |
| `FIREBASE_SERVICE_ACCOUNT` | The full contents of the `.json` key file from step 1.6 |
| `OWNER_EMAIL` | The email you added in step 1.3 |
| `ANDROID_KEYSTORE_B64` | From `android-signing-secrets.txt` (Claude sent you this file) |
| `ANDROID_KEYSTORE_PASSWORD` | From the same file |

3. Repository → *Actions* → enable workflows if asked. Run **Deploy app** (*Run workflow*). The first run also builds the book catalog (about 15 minutes). When it finishes, the run summary shows your link: `https://<project-id>.web.app`.
4. Run **Android app**. When it finishes, open the repository's **Releases** → *Xenoreads for Android* on your phone, download `Xenoreads.apk` and install it (allow installs from your browser when Android asks). Later builds install over it and keep your downloads.

### 3. Install on your phones

- **iPhone**: open your `web.app` link in Safari → Share → **Add to Home Screen**.
- **Android**: the APK from step 2.4, or Chrome → menu → **Install app**.
- **PC**: open the link in Chrome or Edge → install icon in the address bar.

Sign in with the email and password from step 1.3.

---

## Narration: books without audiobooks, and articles

- On any book with Project Gutenberg text, tap **Narrate with AI voice** and pick a narrator. Chapters appear as they finish, so you can start listening while the rest is made.
- **Library → Article**: paste a link (or the text). It plays right away with your phone's voice; tap **Narrate in HD** for the AI voice with synced text. On Android you can also share a link from Chrome straight to Xenoreads.
- On LibriVox books, **Make read-along** transcribes the recording so the text follows the human narrator too.

**When it runs.** The Narrator workflow checks for new requests every 3 hours. To start instantly, create a fine-grained GitHub token (GitHub → *Settings → Developer settings → Fine-grained tokens*), limited to the `xenoreads` repository, with **Actions: Read and write** and **Contents: Read and write**. Paste it with the repo name (`XEDD-997/xenoreads`) in the app's **Settings**; it stays on that device only. The same token works for the PC narrator.

**On your PC (when Actions minutes run out).**
1. Install Python 3.12 if you don't have it: `winget install Python.Python.3.12`
2. Put the service-account `.json` file in the `narrator` folder, renamed to `service-account.json`.
3. Save the GitHub token from above in the `narrator` folder as `github-token.txt`. The narrator uses it to publish audio to your repo's Releases.
4. Double-click **Narrator.bat**. The first run installs everything (about 1 GB). Then it picks up anything you queue in the app. Close the window any time; it resumes from the last finished chapter.

GitHub Actions and your PC share one queue and never work on the same book at once.

---

## How it fits together

```
web/                 the app (no build step): index.html, css/, js/, vendor/ (Firebase SDK), fonts/, icons/
  js/player.js       audio + device-voice engines, read-along view, lock-screen controls, sleep timer
  js/views.js        screens: home, explore, book, library, saved, settings
  js/offline.js      downloads into on-device storage
narrator/            Kokoro narration + Whisper read-along worker (Actions or PC)
tools/               catalog builder, deploy config writer, Android branding
android-overrides/   app icon and the 120 Hz Android activity
.github/workflows/   deploy.yml, android.yml, narrator.yml
```

**Data** (Firestore, readable only by your account): `shelf` (saved books), `progress` (where you stopped), `bookmarks`, `narrations` (AI narrations, articles, read-along jobs), with read-along timings in `narrations/{book}/sync/`. Narrated audio is in the repo's Releases, one pre-release per book (`audio-gb-1342` and so on); delete a release to remove that audio.

**Catalog**: rebuilt every Monday from LibriVox and Project Gutenberg into `web/catalog/` on Firebase Hosting.

**Free limits** (far above one person's use): Firestore 50,000 reads and 20,000 writes a day; Hosting 10 GB stored and 360 MB served a day. LibriVox audio streams straight from archive.org and narrated audio from GitHub, so neither counts against Firebase.

**Preview without Firebase**: serve the `web` folder (for example `python -m http.server` inside it) and open it. The app runs in preview mode with a sample chapter and keeps data on that device.

## Good to know

- Everything in the catalog is public domain in the US (published 1930 or earlier, or released freely). Keep the app private: the security rules only let your account in.
- GitHub pauses scheduled workflows in repositories with no activity for 60 days; any push or a manual run turns them back on.
- If the narrator shows *Stopped* on a book, tap **Try again** on its page. The reason is shown next to it.
