import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  ref, get, set, onValue, onDisconnect, serverTimestamp
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

  // Presença: jogadores só contam como ativos enquanto a conexão estiver viva.
  const presenceRef = ref(db, `presence/${user.uid}`);
  await onDisconnect(presenceRef).remove();
  await set(presenceRef, { active: true, uid: user.uid, updatedAt: serverTimestamp() });

  // A sessão do mestre é compartilhada com todas as contas autenticadas.
  // Este modo prioriza simplicidade e confiança entre jogadores: a geometria e os dados enviados ao navegador são públicos.
  unsubscribers.push(onValue(ref(db, "sessions/main"), snap => {
    if (snap.exists()) {
      const remote = { ...snap.val() };
      if (Array.isArray(remote.dungeonFog) && remote.dungeonFog.length === 50 * 40 && !Array.isArray(remote.dungeonFog[0])) {
        remote.dungeonFog = Array.from({ length: 50 }, (_, x) => remote.dungeonFog.slice(x * 40, (x + 1) * 40));
      }
      applyingRemoteState = true;
      try { window.ValeCorvoApp?.applyState?.(remote); }
      finally { applyingRemoteState = false; }
    } else if (role === "master") {
      queueSessionSave();
    }
  }, showSyncError));

  if (role === "master") {
    unsubscribers.push(onValue(ref(db, "presence"), presenceSnap => {
      const active = presenceSnap.val() || {};
      get(ref(db, "players")).then(playersSnap => {
        const values = playersSnap.val() || {};
        const activePlayers = Object.entries(values)
          .filter(([uid]) => active[uid]?.active === true)
          .map(([uid, data]) => ({ ...data, uid }));
        playerDocs = new Map(activePlayers.map(p => [p.uid, p]));
        window.ValeCorvoApp?.applyPlayerDocs?.(activePlayers);
        queueSessionSave();
      }).catch(showSyncError);
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

  // No modo simplificado, tesouros sincronizados também são enviados a clientes autenticados.
  // Se quiser sigilo real depois, moveremos as descobertas para uma estrutura separada por jogador.
  unsubscribers.push(onValue(ref(db, "treasures"), snap => {
    const values = snap.val() || {};
    const items = Object.entries(values).map(([id, data]) => ({ ...data, id: data?.id ?? id }));
    window.ValeCorvoApp?.setTreasures?.(items);
  }, showSyncError));

});
