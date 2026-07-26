# Affilio — PWA + Android (Capacitor)

Affiliate link tracker & earnings dashboard. Originally a single-file HTML
prototype; this is the production-ready build: Firebase Auth + Firestore
sync, full PWA support, and a Capacitor Android wrapper.

## Folder structure

```
affilio/
├── src/                    # The actual web app (PWA) — this is what ships
│   ├── index.html          # App shell (splash screen, login gate, #root)
│   ├── login.html          # Google / Email sign-in
│   ├── privacy-policy.html
│   ├── terms.html
│   ├── manifest.json       # PWA manifest
│   ├── service-worker.js   # Offline caching
│   ├── css/styles.css
│   ├── js/
│   │   ├── firebase-init.js    # Firebase SDK bootstrap
│   │   ├── firebase-config.js  # ⚠️ fill in your project keys here
│   │   ├── auth.js             # Google + Email/Password sign-in
│   │   ├── data-store.js       # Firestore sync (products/logs/settings)
│   │   ├── app.js              # Main app UI/logic
│   │   └── pwa-install.js      # Custom "Install app" banner
│   └── icons/               # App icons used by the PWA at runtime
├── firebase/                # Firebase project config (not shipped in the app)
│   ├── firebase-config.template.js
│   ├── firestore.rules
│   ├── firestore.indexes.json
│   └── firebase.json        # Firebase Hosting + Firestore deploy config
├── manifest/                 # (kept per spec — mirrors src/manifest.json)
├── icons/                    # Source icon exports (all sizes + adaptive layers)
├── assets/splash/             # Splash screen source images
├── android/                   # Capacitor Android project
│   ├── app/src/main/AndroidManifest.xml
│   ├── app/src/main/res/...   # icons, splash, themes, strings
│   └── build.gradle, settings.gradle, variables.gradle
├── capacitor.config.json
└── package.json
```

## 1. Firebase setup

1. Create a project at https://console.firebase.google.com.
2. Add a **Web app** → copy the config into `src/js/firebase-config.js`
   (template with instructions: `firebase/firebase-config.template.js`).
3. **Authentication** → Sign-in method → enable **Google** and **Email/Password**.
4. **Firestore Database** → Create database (production mode, pick a region).
5. Deploy security rules:
   ```
   npm i -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules --project YOUR_PROJECT_ID --config firebase/firebase.json
   ```
6. Add an **Android app** (package name `com.affilio.app`) in the same
   Firebase project, download `google-services.json`, place it at
   `android/app/google-services.json`.
7. In Google Cloud Console → Credentials, copy the **Web client ID** (created
   automatically when you enabled Google sign-in) into
   `googleWebClientId` in `src/js/firebase-config.js`.

## 2. Run the PWA locally

```
npm install
npm run start          # serves src/ at http://localhost:5173
```

Open it, sign in, and confirm data is syncing to Firestore in the console.

## 3. Install as a PWA

Any modern browser: visit the deployed URL → the in-app "Install Affilio"
banner appears (or use the browser's own install icon in the address bar).
`manifest.json` + `service-worker.js` handle offline caching and the install
prompt.

## 4. Deploy the PWA (Firebase Hosting example)

```
firebase deploy --only hosting --project YOUR_PROJECT_ID --config firebase/firebase.json
```

(Any static host works — Netlify, Vercel, GitHub Pages, S3 — since `src/` is
plain static files. Just make sure `service-worker.js` is served from the
site root/scope you deploy to.)

## 5. Build the Android app

```
npm install
npx cap add android          # generates the remaining Gradle wrapper files
                              # (wrapper JAR, gradlew scripts) into android/
npx cap sync android          # copies src/ into android/app/src/main/assets/public
                               # and wires up capacitor.config.json
```

`npx cap add android` will merge with — not overwrite — the hand-authored
files already in `android/` (AndroidManifest.xml, icons, splash theme,
build.gradle). If it complains about existing files, that's expected; keep
the versions in this repo, they already contain the Firebase + icon + splash
setup.

Then either:
- **Android Studio**: `npx cap open android`, then Build → Generate Signed
  Bundle/APK.
- **CLI**:
  ```
  cd android
  ./gradlew bundleRelease     # → app/build/outputs/bundle/release/*.aab (Play Store)
  ./gradlew assembleRelease   # → app/build/outputs/apk/release/*.apk (sideload/testing)
  ```

Before a release build, replace the debug `signingConfig` in
`android/app/build.gradle` with your own upload keystore — never ship a
Play Store build signed with the debug key.

## 6. Play Store compliance checklist

- [ ] Replace `[DATE]`, `[SUPPORT EMAIL]`, `[COMPANY / DEVELOPER NAME]`
      placeholders in `privacy-policy.html` and `terms.html`, then host the
      privacy policy at a public URL (required in Play Console → App content).
- [ ] Play Console → App content → fill in **Data safety** form to match what
      `privacy-policy.html` actually says is collected (email, name, the
      links/earnings the user enters) and how it's used (account sync only,
      no ads, no data sale).
- [ ] `targetSdkVersion` in `android/variables.gradle` must meet Google
      Play's current minimum target API level at time of submission — check
      https://support.google.com/googleplay/android-developer/answer/11926878
      and bump if needed.
- [ ] Use a real upload keystore for the release build (see step 5) and enable
      Play App Signing.
- [ ] Provide a feature graphic, screenshots, and short/full description in
      Play Console (not included here — app store listing assets, not code).
- [ ] If you keep Google Sign-In, complete the OAuth consent screen in Google
      Cloud Console (app name, logo, support email, scopes) — required before
      it works for external, non-test users.
- [ ] Affiliate-marketing content: make sure the app or its listing doesn't
      claim guaranteed earnings (Play policy on financial/misleading claims);
      the in-app footer already reminds users to disclose "#ad".
- [ ] Test the app fully offline (airplane mode) to confirm the service
      worker / Firestore offline cache behave as expected before submitting.
- [ ] Remove `google-services.json.placeholder` and the TODO comments once
      real config is in place.
