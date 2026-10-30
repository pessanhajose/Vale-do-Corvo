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
let displayNames = new Map(); // uid -> nome de exibição escolhido no login
let pendingNames = new Map();
let gmNotes = new Map();      // id do tesouro -> segredos (somente o mestre lê/escreve)

function stopListeners() {
  unsubscribers.forEach(unsub => { try { unsub(); } catch {} });
  unsubscribers = [];
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
}
let syncChip = null;
let pendingSaves = 0;
let lastSaveFailed = false;
let saveRetries = 0;
function ensureSyncChip() {
  if (syncChip) return syncChip;
  const bar = document.getElementById("firebase-user-bar");
  if (!bar) return null;
  syncChip = document.createElement("button");
  syncChip.type = "button";
  syncChip.id = "sync-status";
  syncChip.style.cssText = "margin-left:.5rem;padding:2px 8px;border-radius:9999px;font-size:11px;border:1px solid #475569;background:#0f172a;color:#94a3b8;cursor:pointer;max-width:70vw;text-align:left";
  syncChip.addEventListener("click", () => { saveRetries = 0; lastSaveFailed = false; queueSessionSave(); });
  bar.appendChild(syncChip);
  return syncChip;
}
function setSyncStatus(kind, detail = "") {
  const chip = ensureSyncChip();
  if (!chip) return;
  const retry = role === "master" ? " — toque para tentar de novo" : "";
  const states = {
    saving: ["⏳ Salvando…", "#94a3b8"],
    ok: ["✓ Salvo " + new Date().toLocaleTimeString("pt-BR"), "#6ee7b7"],
    error: ["⚠ Não salvou: " + detail + retry, "#fca5a5"],
    offline: ["⚠ Sem conexão com o Firebase", "#fcd34d"]
  };
  const [text, color] = states[kind];
  chip.textContent = text;
  chip.style.color = color;
  chip.style.borderColor = color;
  chip.title = detail;
}
function describeSyncError(error) {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("permission")) return "sem permissão — este aparelho (UID) precisa estar em masters, ou as regras do banco foram alteradas";
  return error?.message || error?.code || "erro de sincronização";
}
// Erros ficam visíveis durante o jogo (a mensagem do login some depois de entrar).
function showSyncError(error) {
  console.error("[Vale-do-Corvo/Firebase]", error);
  setSyncStatus("error", describeSyncError(error));
  const message = document.getElementById("firebase-auth-message");
  if (message) {
    message.textContent = "Firebase: " + describeSyncError(error);
    message.className = "text-sm text-red-300 mt-3";
  }
}
// Acompanha cada gravação: mostra "Salvando…", "Salvo" ou o motivo da falha.
async function tracked(fn) {
  pendingSaves++;
  setSyncStatus("saving");
  try {
    const result = await fn();
    lastSaveFailed = false;
    return result;
  } catch (error) {
    lastSaveFailed = true;
    showSyncError(error);
    throw error;
  } finally {
    pendingSaves--;
    if (!pendingSaves && !lastSaveFailed) setSyncStatus("ok");
  }
}
function stateForRealtimeDatabase() {
  const state = window.ValeCorvoApp?.getState?.();
  if (!state) return null;
  return {
    tokens: JSON.parse(JSON.stringify(state.tokens)),
    dungeonFog: state.dungeonFog.flat(),
    mapMode: state.mapMode,
    cryptEntrance: JSON.parse(JSON.stringify(state.cryptEntrance)),
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
  try {
    await set(ref(db, "sessions/main"), state);
  } catch (error) {
    showSyncError(error);
    throw error;
  }
}
function queueSessionSave() {
  if (role !== "master" || !activeUser || applyingRemoteState) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    tracked(saveSessionNow).then(() => { saveRetries = 0; }).catch(error => {
      const denied = String(error?.code || "").toLowerCase().includes("permission");
      if (!denied && saveRetries < 5) { saveRetries++; setTimeout(queueSessionSave, 3000 * saveRetries); }
    });
  }, 500);
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
  try {
    if (role === "player") {
      await set(ref(db, `players/${activeUser.uid}`), clean);
    } else if (role === "master" && token.type === "hero") {
      const tokenUid = String(token.id || "").startsWith("player-") ? String(token.id).slice(7) : null;
      const matching = tokenUid && playerDocs.has(tokenUid)
        ? [tokenUid, playerDocs.get(tokenUid)]
        : [...playerDocs.entries()].find(([, data]) => data.characterName === token.name);
      if (matching) {
        await set(ref(db, `players/${matching[0]}`), { ...clean, uid: matching[0] });
      }
      try { await saveOtherHeroes(token); } catch (error) { showSyncError(error); }
      await saveSessionNow();
    } else if (role === "master") {
      await saveSessionNow();
    }
  } catch (error) {
    showSyncError(error);
    throw error;
  }
}
// Ao entrar/sair da cripta o mestre reposiciona TODOS os heróis localmente. Se só o token arrastado
// fosse gravado, o próximo snapshot de players/* devolveria os outros ao mapa/posição antigos
// e eles sumiriam da tela até um F5.
async function saveOtherHeroes(skipToken) {
  const state = window.ValeCorvoApp?.getState?.();
  if (!state) return;
  for (const hero of state.tokens) {
    if (hero.type !== "hero" || hero.id === skipToken.id) continue;
    const uid = String(hero.id || "").startsWith("player-") ? String(hero.id).slice(7) : null;
    const doc = uid && playerDocs.get(uid);
    if (!doc || !Number.isInteger(hero.x) || !Number.isInteger(hero.y)) continue;
    const map = hero.map === "dungeon" ? "dungeon" : "overworld";
    if (doc.x === hero.x && doc.y === hero.y && doc.map === map) continue;
    await set(ref(db, `players/${uid}`), {
      uid, characterName: doc.characterName, map,
      x: Math.max(0, Math.min(49, hero.x)), y: Math.max(0, Math.min(39, hero.y)),
      updatedAt: serverTimestamp()
    });
  }
}
async function saveExploration() {
  if (!activeUser) return;
  const state = window.ValeCorvoApp?.getState?.();
  if (!state?.dungeonFog) return;
  try {
    await set(ref(db, `exploration/${activeUser.uid}`), {
      uid: activeUser.uid,
      dungeonFog: state.dungeonFog.flat(),
      mapMode: state.mapMode,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    showSyncError(error);
    throw error;
  }
}
// Os tesouros públicos ficam em sessions/treasures: as regras do banco liberam leitura de sessions/*
// para todos os logados, enquanto treasures/ só tem regra de leitura por id (listar a coleção é negado).
async function saveTreasures(items) {
  if (role !== "master" || !activeUser || !Array.isArray(items)) return;
  const map = {};
  for (const item of items) {
    if (item?.id === undefined || item?.id === null) continue;
    const id = String(item.id);
    const { id: ignoredId, ...data } = item;
    map[id] = { ...data, id };
  }
  // JSON remove campos undefined, que o Firebase recusaria.
  const clean = JSON.parse(JSON.stringify(map));
  await set(ref(db, "sessions/treasures"), { items: clean, updatedAt: serverTimestamp(), updatedBy: activeUser.uid });
}

// Migração única: se o novo nó estiver vazio, o mestre recupera os tesouros gravados no caminho antigo.
let migratedTreasures = false;
async function migrateOldTreasures() {
  if (migratedTreasures || role !== "master" || !activeUser) return;
  migratedTreasures = true;
  const ids = [...Array(40).keys()].map(i => 101 + i).concat([...Array(40).keys()].map(i => 201 + i));
  const found = [];
  await Promise.all(ids.map(async id => {
    try {
      const snap = await get(ref(db, `treasures/${id}`));
      if (snap.exists()) found.push({ ...snap.val(), id });
    } catch (_) { /* sem permissão ou inexistente */ }
  }));
  if (found.length) await saveTreasures(found);
}
const withStatus = fn => (...args) => tracked(() => fn(...args));
window.ValeCorvoSync = {
  queueSessionSave,
  saveTokenPosition: withStatus(saveTokenPosition),
  saveExploration: withStatus(saveExploration),
  saveTreasures: withStatus(saveTreasures),
  saveGmNotes: withStatus(saveGmNotes)
};

onAuthStateChanged(auth, async user => {
  const previousUser = activeUser;
  stopListeners();
  if (previousUser && (!user || previousUser.uid !== user.uid)) {
    // Logout também encerra a presença; onDisconnect sozinho não cobre logout explícito.
    set(ref(db, `presence/${previousUser.uid}`), null).catch(() => {});
  }
  activeUser = user;
  role = null;
  playerDocs = new Map();
  displayNames = new Map();
  pendingNames = new Map();
  gmNotes = new Map();
  migratedTreasures = false;
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
  // O onDisconnect é consumido pelo servidor quando a conexão cai (aba em segundo plano, celular
  // bloqueado, rede instável). Por isso a presença é refeita a cada reconexão, não só no login;
  // do contrário o mestre deixava de ver o token até o jogador recarregar a página (F5).
  unsubscribers.push(onValue(ref(db, ".info/connected"), snap => {
    if (snap.val() === true) {
      announcePresence();
      if (!lastSaveFailed) setSyncStatus("ok");
    } else {
      setSyncStatus("offline");
    }
  }, showSyncError));

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
    // Mantém os dois conjuntos em memória: a atualização de presença ou de personagem
    // recalcula a lista, sem depender de um get() disparado apenas por um dos listeners.
    let presenceValues = {};
    let playersValues = {};
    const refreshActivePlayers = () => {
      const activePlayers = Object.entries(playersValues)
        .filter(([uid, data]) => presenceValues[uid]?.active === true && data)
        .map(([uid, data]) => ({ ...data, uid, displayName: displayNames.get(uid) || "" }));
      playerDocs = new Map(activePlayers.map(p => [p.uid, p]));
      window.ValeCorvoApp?.applyPlayerDocs?.(activePlayers);
      // Busca o nome de exibição dos jogadores novos e redesenha quando chegar.
      activePlayers.filter(p => !displayNames.has(p.uid)).forEach(p => {
        loadDisplayName(p.uid).then(name => { if (name) refreshActivePlayers(); });
      });
    };
    unsubscribers.push(onValue(ref(db, "presence"), snap => {
      presenceValues = snap.val() || {};
      refreshActivePlayers();
    }, showSyncError));
    unsubscribers.push(onValue(ref(db, "players"), snap => {
      playersValues = snap.val() || {};
      refreshActivePlayers();
    }, showSyncError));
  } else {
    unsubscribers.push(onValue(ref(db, `players/${user.uid}`), snap => {
      if (snap.exists()) {
        const player = snap.val();
        window.firebaseCharacterName = player.characterName || null;
        const applyOwn = () => window.ValeCorvoApp?.applyOwnPlayerDoc?.(
          { ...player, displayName: displayNames.get(user.uid) || user.displayName || "" });
        applyOwn();
        if (!displayNames.has(user.uid)) loadDisplayName(user.uid).then(name => { if (name) applyOwn(); });
      }
    }, showSyncError));
  }

  // No modo simplificado, tesouros sincronizados também são enviados a clientes autenticados.
  // Se quiser sigilo real depois, moveremos as descobertas para uma estrutura separada por jogador.
  unsubscribers.push(onValue(ref(db, "sessions/treasures"), snap => {
    const values = snap.val()?.items || {};
    const items = Object.entries(values).map(([id, data]) => ({ ...data, id: data?.id ?? id }));
    window.ValeCorvoApp?.setTreasures?.(items);
    loadGmNotes(items);
    if (!items.length) migrateOldTreasures();
  }, showSyncError));

});
