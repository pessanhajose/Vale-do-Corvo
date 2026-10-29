import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  ref, get, set, onValue, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

let activeUser = null;
let role = null;
let saveTimer = null;
let applyingRemoteState = false;
let playerDocs = new Map();
let unsubscribers = [];

function stopListeners() {
  unsubscribers.forEach(unsub => { try { unsub(); } catch {} });
  unsubscribers = [];
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
}
function showSyncError(error) {
  console.error("[Vale-do-Corvo/Firebase]", error);
  const message = document.getElementById("firebase-auth-message");
  if (message) {
    const denied = error?.code === "PERMISSION_DENIED" || error?.code === "permission_denied";
    message.textContent = "Firebase: " + (denied
      ? "acesso negado pelas regras do Realtime Database."
      : error?.message || error?.code || "erro de sincronização.");
    message.className = "text-sm text-red-300 mt-3";
  }
}
function stateForRealtimeDatabase() {
  const state = window.ValeCorvoApp?.getState?.();
  if (!state) return null;
  return {
    tokens: state.tokens,
    dungeonFog: state.dungeonFog.flat(),
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
  const state = stateForRealtimeDatabase();
  if (!state) return;
  await set(ref(db, "sessions/main"), state);
}
function queueSessionSave() {
  if (role !== "master" || !activeUser || applyingRemoteState) return;
  if (saveTimer) clearTimeout(saveTimer);
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
    await set(ref(db, `players/${activeUser.uid}`), clean);
  } else if (role === "master" && token.type === "hero") {
    const matching = [...playerDocs.entries()].find(([, data]) => data.characterName === token.name);
    if (matching) {
      await set(ref(db, `players/${matching[0]}`), { ...clean, uid: matching[0] });
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
  await set(ref(db, `exploration/${activeUser.uid}`), {
    uid: activeUser.uid,
    dungeonFog: state.dungeonFog.flat(),
    mapMode: state.mapMode,
    updatedAt: serverTimestamp()
  });
}
async function saveTreasures(items) {
  if (role !== "master" || !activeUser || !Array.isArray(items)) return;
  for (const item of items) {
    if (item?.id === undefined || item?.id === null) continue;
    const id = String(item.id);
    const { id: ignoredId, ...data } = item;
    await set(ref(db, `treasures/${id}`), {
      ...data,
      id,
      updatedAt: serverTimestamp(),
      updatedBy: activeUser.uid
    });
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
    const profileSnap = await get(ref(db, `users/${user.uid}`));
    role = profileSnap.exists() && profileSnap.val()?.role === "master" ? "master" : "player";
    window.firebaseRole = role;
  } catch (error) {
    showSyncError(error);
    return;
  }

  if (role === "master") {
    unsubscribers.push(onValue(ref(db, "sessions/main"), snap => {
      if (snap.exists()) {
        const remote = { ...snap.val() };
        if (Array.isArray(remote.dungeonFog) && remote.dungeonFog.length === 50 * 40 && !Array.isArray(remote.dungeonFog[0])) {
          remote.dungeonFog = Array.from({ length: 50 }, (_, x) => remote.dungeonFog.slice(x * 40, (x + 1) * 40));
        }
        applyingRemoteState = true;
        try { window.ValeCorvoApp?.applyState?.(remote); }
        finally { applyingRemoteState = false; }
      } else {
        queueSessionSave();
      }
    }, showSyncError));

    unsubscribers.push(onValue(ref(db, "players"), snap => {
      const values = snap.val() || {};
      playerDocs = new Map(Object.entries(values));
      window.ValeCorvoApp?.applyPlayerDocs?.(Object.values(values));
    }, showSyncError));

    unsubscribers.push(onValue(ref(db, "treasures"), snap => {
      const values = snap.val() || {};
      const items = Object.entries(values).map(([id, data]) => ({ ...data, id: data?.id ?? id }));
      window.ValeCorvoApp?.setTreasures?.(items);
    }, showSyncError));
  } else {
    unsubscribers.push(onValue(ref(db, `players/${user.uid}`), snap => {
      if (snap.exists()) {
        const player = snap.val();
        window.firebaseCharacterName = player.characterName || null;
        window.ValeCorvoApp?.applyOwnPlayerDoc?.(player);
      }
    }, showSyncError));
  }

  unsubscribers.push(onValue(ref(db, `exploration/${user.uid}`), snap => {
    const data = snap.val();
    if (Array.isArray(data?.dungeonFog)) {
      let grid = data.dungeonFog;
      if (grid.length === 50 * 40 && !Array.isArray(grid[0])) {
        grid = Array.from({ length: 50 }, (_, x) => data.dungeonFog.slice(x * 40, (x + 1) * 40));
      }
      if (Array.isArray(grid[0])) {
        applyingRemoteState = true;
        try {
          const current = window.ValeCorvoApp?.getState?.();
          if (current) window.ValeCorvoApp.applyState({ ...current, dungeonFog: grid });
        } finally { applyingRemoteState = false; }
      }
    }
  }, showSyncError));
});
