// Thin sync layer over Firestore. Each signed-in user gets three documents:
//   users/{uid}/appData/products  -> { items: Product[] }
//   users/{uid}/appData/logs      -> { items: LogEntry[] }
//   users/{uid}/appData/settings  -> { ...settings }
//
// Firestore's persistentLocalCache (enabled in firebase-init.js) means reads
// and writes keep working offline; changes queue and flush automatically
// once connectivity returns. onSnapshot below fires from the local cache
// immediately, then again when the server confirms — the app just re-renders.

import {
  doc,
  setDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { db } from "./firebase-init.js";

function docRef(uid, name) {
  return doc(db, "users", uid, "appData", name);
}

/**
 * Subscribe to one of the three app documents for a user.
 * @param {string} uid
 * @param {'products'|'logs'|'settings'} name
 * @param {(data: any) => void} onData called with the raw document data (or null if it doesn't exist yet)
 * @returns {() => void} unsubscribe function
 */
export function subscribe(uid, name, onData) {
  return onSnapshot(
    docRef(uid, name),
    { includeMetadataChanges: false },
    (snap) => onData(snap.exists() ? snap.data() : null),
    (err) => console.error(`[data-store] ${name} subscription error:`, err)
  );
}

export async function writeProducts(uid, products) {
  return setDoc(docRef(uid, "products"), { items: products, updatedAt: Date.now() });
}

export async function writeLogs(uid, logs) {
  return setDoc(docRef(uid, "logs"), { items: logs, updatedAt: Date.now() });
}

export async function writeSettings(uid, settings) {
  return setDoc(docRef(uid, "settings"), { ...settings, updatedAt: Date.now() });
}

// One-time migration: if a user has pre-existing localStorage data from
// before they signed in (e.g. they used the app as a guest), push it up to
// Firestore the first time they log in, then clear the local copy.
export async function migrateLocalGuestData(uid) {
  const keys = { products: "affilio_guest_products", logs: "affilio_guest_logs", settings: "affilio_guest_settings" };
  try {
    const rawProducts = localStorage.getItem(keys.products);
    const rawLogs = localStorage.getItem(keys.logs);
    const rawSettings = localStorage.getItem(keys.settings);
    if (rawProducts) await writeProducts(uid, JSON.parse(rawProducts));
    if (rawLogs) await writeLogs(uid, JSON.parse(rawLogs));
    if (rawSettings) await writeSettings(uid, JSON.parse(rawSettings));
    Object.values(keys).forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    console.warn("[data-store] guest migration skipped:", e.message);
  }
}

// Guest-mode (pre-login) local persistence, kept separate from the
// per-account Firestore data so nothing leaks between accounts on a shared device.
export const guestLocal = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem("affilio_guest_" + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("affilio_guest_" + key, JSON.stringify(value));
    } catch {}
  },
};
