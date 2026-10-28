import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const stateRef = doc(db, "sessions", "main");
let activeUser = null;
let role = null;
let saveTimer = null;
let applyingRemoteState = false;
let playerDocs = new Map();
let unsubscribers = [];

function stopListeners() {
  unsubscribers.forEach(unsub => { try { unsub(); } catch {} });
  unsubscribers = [];
}
function showSyncError(error) {
  console.error("[Vale-do-Corvo/Firebase]", error);
  const message = document.getElementById("firebase-auth-message");
  if (message && error?.code) {
    message.textContent = "Firebase: " + (error.code === "permission-denied"
      ? "acesso negado pelas regras do Firestore."
      : error.message || error.code);
    message.className = "text-sm text-red-300 mt-3";
  }
}
function stateForFirestore() {
  const state = window.ValeCorvoApp?.getState?.();
  if (!state) return null;
  return {
    tokens: state.tokens,
    dungeonFog: state.dungeonFog,
    mapMode: state.mapMode,
    cryptEntrance: state.cryptEntrance,
    visionRadius: state.visionRadius,
    magicVisionEnabled: state.magicVisionEnabled,
    updatedAt: serverTimestamp(),
    updatedBy: activeUser?.uid || null
  };
}
async function saveSessionNow() {
  if (role !== "master" || !activeUser || applyingRemoteState) return;
  const state = stateForFirestore();
  if (!state) return;
  await setDoc(stateRef, state, { merge: true });
}
function queueSessionSave() {
  if (role !== "master" || !activeUser || applyingRemoteState) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSessionNow().catch(showSyncError), 500);
}
async function saveTokenPosition(token) {
  if (!activeUser || !token || !Number.isInteger(token.x) || !Number.isInteger(token.y)) return;
  const clean = {
    uid: activeUser.uid,
    characterName: String(token.name || "").slice(0, 60),
    map: token.map === "dungeon" ? "dungeon" : "overworld",
    x: Math.max(0, Math.min(49, token.x)),
    y: Math.max(0, Math.min(39, token.y)),
    updatedAt: serverTimestamp()
  };
  if (role === "player") {
    const playerRef = doc(db, "players", activeUser.uid);
    await setDoc(playerRef, clean, { merge: true });
  } else if (role === "master" && token.type === "hero") {
    const matching = [...playerDocs.entries()].find(([, data]) => data.characterName === token.name);
    if (matching) {
      await setDoc(doc(db, "players", matching[0]), {
        ...clean, uid: matching[0]
      }, { merge: true });
    }
    await saveSessionNow();
  } else if (role === "master") {
    await saveSessionNow();
  }
}
async function saveExploration() {
  if (!activeUser) return;
  const state = window.ValeCorvoApp?.getState?.();
  if (!state?.dungeonFog) return;
  await setDoc(doc(db, "exploration", activeUser.uid), {
    uid: activeUser.uid,
    dungeonFog: state.dungeonFog,
    mapMode: state.mapMode,
    updatedAt: serverTimestamp()
  }, { merge: true });
}
async function saveTreasures(items) {
  if (role !== "master" || !activeUser || !Array.isArray(items)) return;
  for (const item of items) {
    if (item?.id === undefined || item?.id === null) continue;
    const id = String(item.id);
    const { id: ignoredId, ...data } = item;
    await setDoc(doc(db, "treasures", id), {
      ...data,
      id,
      updatedAt: serverTimestamp(),
      updatedBy: activeUser.uid
    }, { merge: true });
  }
}
window.ValeCorvoSync = { queueSessionSave, saveTokenPosition, saveExploration, saveTreasures };

onAuthStateChanged(auth, async user => {
  stopListeners();
  activeUser = user;
  role = null;
  playerDocs = new Map();
  if (!user) return;
  try {
    const profile = await getDoc(doc(db, "users", user.uid));
    role = profile.exists() ? profile.data()?.role : null;
    window.firebaseRole = role;
  } catch (error) {
    showSyncError(error);
    return;
  }
  if (!role) return;

  if (role === "master") {
    unsubscribers.push(onSnapshot(stateRef, snap => {
      if (snap.exists()) {
        applyingRemoteState = true;
        try { window.ValeCorvoApp?.applyState?.(snap.data()); }
        finally { applyingRemoteState = false; }
      } else {
        queueSessionSave();
      }
    }, showSyncError));

    unsubscribers.push(onSnapshot(collection(db, "players"), snap => {
      playerDocs = new Map(snap.docs.map(d => [d.id, d.data()]));
      window.ValeCorvoApp?.applyPlayerDocs?.(snap.docs.map(d => d.data()));
    }, showSyncError));

    unsubscribers.push(onSnapshot(collection(db, "treasures"), snap => {
      const items = snap.docs.map(d => ({ ...d.data(), id: d.data().id ?? d.id }));
      window.ValeCorvoApp?.setTreasures?.(items);
    }, showSyncError));
  } else {
    const playerRef = doc(db, "players", user.uid);
    unsubscribers.push(onSnapshot(playerRef, snap => {
      if (snap.exists()) window.ValeCorvoApp?.applyOwnPlayerDoc?.(snap.data());
    }, showSyncError));
  }

  unsubscribers.push(onSnapshot(doc(db, "exploration", user.uid), snap => {
    const data = snap.data();
    if (data?.dungeonFog) {
      applyingRemoteState = true;
      try {
        const current = window.ValeCorvoApp?.getState?.();
        if (current) window.ValeCorvoApp.applyState({ ...current, dungeonFog: data.dungeonFog });
      } finally { applyingRemoteState = false; }
    }
  }, showSyncError));
});
