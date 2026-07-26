// Firebase app bootstrap — modular v10 SDK loaded from Google's CDN as ESM.
// Works unmodified in the browser PWA and inside the Capacitor Android WebView.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { firebaseConfig, googleWebClientId } from "./firebase-config.js";

export const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
setPersistence(auth, browserLocalPersistence).catch(() => {});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
export { googleWebClientId };

// Firestore with offline persistence (IndexedDB-backed cache) so the app
// keeps working — reads and queued writes — without a network connection.
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
});
