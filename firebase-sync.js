import { auth, db } from "./firebase-config.js?v=2026-10-30.3";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  ref, get, set, update, onValue, onDisconnect, serverTimestamp
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
// Segredos (respostas e consequências) ficam em gmNotes/<id>: as regras do banco só liberam
// leitura e escrita para o mestre, então jogadores não conseguem ler nem pelo console.
// O mestre só grava no mapa e só enxerga jogadores se o UID dele estiver em masters/ no banco.
// Quando não está, tudo parece funcionar mas nada salva: este aviso deixa o motivo e o UID na tela.
const OWNER_UID = "cPr3vPhG5XPS6ifk5NixuAjNui82";
async function checkMasterAuthorization(user) {
  const old = document.getElementById("master-auth-banner");
  if (old) old.remove();
  if (!user || role !== "master" || user.uid === OWNER_UID) return;
  let authorized = false;
  try {
    const snap = await get(ref(db, `masters/${user.uid}`));
    authorized = snap.val() === true;
  } catch (error) { authorized = false; }
  if (authorized) return;
  const banner = document.createElement("div");
  banner.id = "master-auth-banner";
  banner.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:10000;background:#7f1d1d;color:#fee2e2;padding:10px 12px;font:13px/1.4 Inter,sans-serif;border-bottom:2px solid #f87171";
  const text = document.createElement("div");
  text.append("⚠ Este aparelho NÃO está autorizado como mestre no banco. Sem isso o progresso não é salvo e os jogadores que entram não aparecem. No Firebase, abra Realtime Database → masters e adicione este UID com valor true: ");
  const code = document.createElement("code");
  code.textContent = user.uid;
  code.style.cssText = "background:#450a0a;padding:2px 6px;border-radius:4px;user-select:all;word-break:break-all";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copiar UID";
  copy.style.cssText = "margin-left:8px;padding:2px 10px;border-radius:6px;border:1px solid #fca5a5;background:#991b1b;color:#fff;cursor:pointer";
  copy.addEventListener("click", () => { navigator.clipboard?.writeText(user.uid).then(() => { copy.textContent = "Copiado ✓"; }); });
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "✕";
  close.style.cssText = "float:right;margin-left:8px;padding:0 8px;border:0;background:transparent;color:#fff;font-size:16px;cursor:pointer";
  close.addEventListener("click", () => banner.remove());
  text.append(code, copy);
  banner.append(close, text);
  document.body.appendChild(banner);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") announcePresence();
});
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
    // Névoa ambiental: liga/desliga e intensidade para mestre e jogadores.
    mistEnabled: state.mistEnabled === true,
    mistDensity: Number.isFinite(state.mistDensity)
      ? Math.max(0.2, Math.min(0.95, state.mistDensity)) : 0.85,
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
// Névoa ambiental em nó isolado: alternar não regrava tokens, mapa ou progresso.
async function saveMistSettings(settings) {
  if (role !== "master" || !activeUser || !settings) return;
  await tracked(() => set(ref(db, "sessions/mist"), {
    enabled: settings.enabled === true,
    density: Number.isFinite(settings.density)
      ? Math.max(0.2, Math.min(0.95, settings.density)) : 0.85,
    updatedAt: serverTimestamp(),
    updatedBy: activeUser.uid
  }));
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

/** Publica a presença do usuário na conexão atual. */
async function announcePresence() {
  const user = activeUser;
  if (!user) return;
  const presenceRef = ref(db, `presence/${user.uid}`);
  await onDisconnect(presenceRef).remove();
  if (activeUser?.uid !== user.uid) return;
  // O primeiro onAuthStateChanged pode ocorrer antes de o formulário salvar o
  // displayName; busque o perfil próprio para evitar publicar um nome vazio.
  let name = String(user.displayName || "").trim();
  try {
    const profile = await get(ref(db, `users/${user.uid}`));
    if (profile.exists() && typeof profile.val()?.displayName === "string") {
      name = profile.val().displayName.trim() || name;
    }
  } catch (error) {
    console.warn("[Vale-do-Corvo] Nome de perfil indisponível:", error);
  }
  if (activeUser?.uid !== user.uid) return;
  await set(presenceRef, {
    uid: user.uid,
    active: true,
    displayName: name.slice(0, 60),
    updatedAt: serverTimestamp()
  });
}

/** Busca e memoriza o nome público do perfil, sem leituras simultâneas duplicadas. */
async function loadDisplayName(uid) {
  if (!uid) return "";
  if (displayNames.has(uid)) return displayNames.get(uid) || "";
  if (pendingNames.has(uid)) return pendingNames.get(uid);
  const request = get(ref(db, `users/${uid}`))
    .then(snap => {
      const value = snap.exists() ? snap.val() : null;
      const name = typeof value?.displayName === "string" ? value.displayName.trim() : "";
      displayNames.set(uid, name);
      return name;
    })
    .catch(error => {
      showSyncError(error);
      return "";
    })
    .finally(() => pendingNames.delete(uid));
  pendingNames.set(uid, request);
  return request;
}

/** Lê cada segredo individualmente, respeitando as regras de gmNotes/{id}. */
async function loadGmNotes(items) {
  if (role !== "master" || !activeUser) {
    window.ValeCorvoApp?.setGmNotes?.({});
    return;
  }
  const ids = [...new Set((Array.isArray(items) ? items : [])
    .map(item => item?.id)
    .filter(id => id !== undefined && id !== null)
    .map(String)
    .filter(id => /^[A-Za-z0-9_-]{1,80}$/.test(id)))];
  const pairs = await Promise.all(ids.map(async id => {
    const snap = await get(ref(db, `gmNotes/${id}`));
    return snap.exists() ? [id, snap.val()] : null;
  }));
  window.ValeCorvoApp?.setGmNotes?.(Object.fromEntries(pairs.filter(Boolean)));
}

/** Grava segredos por item para respeitar as regras existentes em gmNotes/{id}. */
async function saveGmNotes(notes) {
  if (role !== "master" || !activeUser || !notes || typeof notes !== "object" || Array.isArray(notes)) return;
  const writes = Object.entries(notes)
    .filter(([id, note]) => /^[A-Za-z0-9_-]{1,80}$/.test(id) && note && typeof note === "object")
    .map(([id, note]) => set(ref(db, `gmNotes/${id}`), JSON.parse(JSON.stringify(note))));
  await Promise.all(writes);
  window.ValeCorvoApp?.setGmNotes?.(notes);
}

// A sala de chegada é a Câmara Ritualística (interior livre, longe das paredes).
function partyArrivalSpots(count) {
  const spots = [];
  for (let y = 19; y <= 21; y++) for (let x = 20; x <= 25; x++) spots.push({x,y});
  for (let y = 18; y <= 22; y++) for (let x = 19; x <= 26; x++) {
    if (!spots.some(p => p.x === x && p.y === y)) spots.push({x,y});
  }
  return Array.from({length:count}, (_,i) => spots[i % spots.length]);
}
let partyTravelInProgress = false;
let pendingRequestedTravel = null;
// Mestre é o único autorizado a atualizar os documentos de todos os jogadores.
// A atualização multipath é atômica: o mapa e todos os heróis mudam juntos.
async function performPartyTravel(mode) {
  if (role !== "master" || !activeUser || partyTravelInProgress) return;
  if (mode !== "dungeon" && mode !== "overworld") return;
  partyTravelInProgress = true;
  try {
    const current = window.ValeCorvoApp?.getState?.();
    const group = [...playerDocs.entries()].sort(([a],[b]) => a.localeCompare(b));
    if (!group.length) return;
    const positions = partyArrivalSpots(group.length);
    const updates = {};
    for (let i = 0; i < group.length; i++) {
      const [uid, doc] = group[i];
      const spot = mode === "dungeon" ? positions[i] :
        {x:Math.min(49, (current?.cryptEntrance?.x ?? 8) + i % 2),
         y:Math.min(39, (current?.cryptEntrance?.y ?? 8) + Math.floor(i / 2))};
      updates[`players/${uid}`] = {
        uid, characterName: doc.characterName, map: mode, x:spot.x, y:spot.y,
        updatedAt: serverTimestamp()
      };
    }
    updates["sessions/main/mapMode"] = mode;
    updates["sessions/main/updatedAt"] = serverTimestamp();
    updates["sessions/main/updatedBy"] = activeUser.uid;
    await update(ref(db), updates);
  } catch (error) {
    showSyncError(error);
    throw error;
  } finally {
    partyTravelInProgress = false;
  }
}
// Jogador anuncia a entrada por meio de seu documento (permissão própria).
// O mestre conectado coordena o grupo ao receber a mudança.
async function requestPartyTravel(mode) {
  if (!activeUser || (mode !== "dungeon" && mode !== "overworld")) return;
  if (role === "master") return tracked(() => performPartyTravel(mode));
  if (role !== "player") return;
  const state = window.ValeCorvoApp?.getState?.();
  const me = state?.tokens?.find(t => t.id === `player-${activeUser.uid}`);
  if (!me) return;
  const spot = mode === "dungeon" ? {x:21,y:20} :
    {x:Math.max(0,Math.min(49,state.cryptEntrance?.x ?? 8)),y:Math.max(0,Math.min(39,state.cryptEntrance?.y ?? 8))};
  await tracked(() => set(ref(db, `players/${activeUser.uid}`), {
    uid:activeUser.uid, characterName:me.name, map:mode,
    x:spot.x, y:spot.y, updatedAt:serverTimestamp()
  }));
}

const withStatus = fn => (...args) => tracked(() => fn(...args));
window.ValeCorvoSync = {
  queueSessionSave,
  requestPartyTravel: (...args) => requestPartyTravel(...args).catch(showSyncError),
  saveMistSettings: (...args) => saveMistSettings(...args).catch(showSyncError),
  // Login concluído: atualiza o nome visível sem esperar a próxima reconexão.
  refreshPresence: () => announcePresence().catch(showSyncError),
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
  checkMasterAuthorization(user);

  // Presença: jogadores só contam como ativos enquanto a conexão estiver viva.
  // O onDisconnect é consumido pelo servidor quando a conexão cai (aba em segundo plano, celular
  // bloqueado, rede instável). Por isso a presença é refeita a cada reconexão, não só no login;
  // do contrário o mestre deixava de ver o token até o jogador recarregar a página (F5).
  unsubscribers.push(onValue(ref(db, ".info/connected"), snap => {
    if (snap.val() === true) {
      announcePresence().catch(showSyncError);
      if (!lastSaveFailed) setSyncStatus("ok");
    } else {
      setSyncStatus("offline");
    }
  }, showSyncError));

  // O mestre começa toda nova entrada sem névoa, e todos os jogadores
  // acompanham o mesmo nó de maneira independente das gravações do mapa.
  let firstMistSnapshot = true;
  unsubscribers.push(onValue(ref(db, "sessions/mist"), snap => {
    if (firstMistSnapshot) {
      firstMistSnapshot = false;
      if (role === "master") {
        saveMistSettings({ enabled: false, density: snap.val()?.density ?? 0.85 })
          .catch(showSyncError);
        window.ValeCorvoApp?.applyMistSettings?.({ enabled: false, density: snap.val()?.density ?? 0.85 });
        return;
      }
    }
    window.ValeCorvoApp?.applyMistSettings?.(snap.exists()
      ? snap.val() : { enabled: false, density: 0.85 });
  }, showSyncError));

  // O mapa segue sincronizado separadamente da névoa ambiental.
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
        .map(([uid, data]) => ({
          ...data, uid,
          displayName: presenceValues[uid]?.displayName || displayNames.get(uid) || ""
        }));
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
    let previousMaps = null;
    unsubscribers.push(onValue(ref(db, "players"), snap => {
      playersValues = snap.val() || {};
      refreshActivePlayers();
      const nextMaps = new Map(Object.entries(playersValues).map(([uid, data]) => [uid, data?.map]));
      if (previousMaps && !partyTravelInProgress) {
        // Só mudanças de mapa de um personagem já acompanhado iniciam uma
        // transição. Assim o login de alguém com progresso antigo não causa
        // teleporte indevido de toda a campanha.
        for (const [uid, doc] of Object.entries(playersValues)) {
          if (!playerDocs.has(uid) || !previousMaps.has(uid)) continue;
          if (previousMaps.get(uid) === doc?.map) continue;
          const campaignMode = window.ValeCorvoApp?.getState?.().mapMode;
          if ((doc.map === "dungeon" || doc.map === "overworld") &&
              doc.map !== campaignMode) {
            performPartyTravel(doc.map).catch(showSyncError);
            break;
          }
        }
      }
      previousMaps = nextMaps;
    }, showSyncError));
  } else {
    // Jogadores também recebem a lista de personagens conectados.
    // A regra de leitura é aberta apenas para usuários autenticados; cada um continua
    // podendo escrever somente em players/{seu próprio UID}.
    let presenceValues = {};
    let playersValues = {};
    const refreshVisiblePlayers = () => {
      const visiblePlayers = Object.entries(playersValues)
        .filter(([uid, data]) => presenceValues[uid]?.active === true && data)
        .map(([uid, data]) => ({
          ...data, uid,
          displayName: presenceValues[uid]?.displayName || (uid === user.uid ? user.displayName : "") || data.displayName || data.characterName || ""
        }));
      playerDocs = new Map(visiblePlayers.map(p => [p.uid, p]));
      window.ValeCorvoApp?.applyPlayerDocs?.(visiblePlayers);
    };
    unsubscribers.push(onValue(ref(db, "presence"), snap => {
      presenceValues = snap.val() || {};
      refreshVisiblePlayers();
    }, showSyncError));
    unsubscribers.push(onValue(ref(db, "players"), snap => {
      playersValues = snap.val() || {};
      refreshVisiblePlayers();
    }, showSyncError));
  }

  // No modo simplificado, tesouros sincronizados também são enviados a clientes autenticados.
  // Se quiser sigilo real depois, moveremos as descobertas para uma estrutura separada por jogador.
  unsubscribers.push(onValue(ref(db, "sessions/treasures"), snap => {
    const values = snap.val()?.items || {};
    const items = Object.entries(values).map(([id, data]) => ({ ...data, id: data?.id ?? id }));
    window.ValeCorvoApp?.setTreasures?.(items);
    loadGmNotes(items).catch(showSyncError);
    if (!items.length) migrateOldTreasures();
  }, showSyncError));

});
