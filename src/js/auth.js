import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

import { auth, googleProvider } from "./firebase-init.js";

// Capacitor's native WebView can't reliably complete an OAuth popup, so we
// branch to the redirect flow there. On the open web, popup is smoother.
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

export async function signInWithGoogle() {
  if (isNative()) {
    return signInWithRedirect(auth, googleProvider);
  }
  return signInWithPopup(auth, googleProvider);
}

// Call once on app boot to pick up the result of a redirect-based sign-in.
export async function consumeRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    return result ? result.user : null;
  } catch (err) {
    console.warn("Redirect sign-in error:", err.message);
    return null;
  }
}

export async function signUpWithEmail(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  return cred.user;
}

export async function signInWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signOutUser() {
  return signOut(auth);
}

export function currentUser() {
  return auth.currentUser;
}

// Friendly error text for the login form.
export function friendlyAuthError(err) {
  const code = err && err.code ? err.code : "";
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/network-request-failed": "Network error — check your connection.",
    "auth/too-many-requests": "Too many attempts. Try again in a bit.",
  };
  return map[code] || (err && err.message) || "Something went wrong. Please try again.";
}
