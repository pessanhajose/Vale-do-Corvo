import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  ref, get, set, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const gate = document.getElementById("auth-gate");
const form = document.getElementById("firebase-auth-form");
const emailInput = document.getElementById("firebase-email");
const passwordInput = document.getElementById("firebase-password");
const nameInput = document.getElementById("firebase-display-name");
const nameWrap = document.getElementById("firebase-name-wrap");
const characterWrap = document.getElementById("firebase-character-wrap");
const characterSelect = document.getElementById("firebase-character-name");
const message = document.getElementById("firebase-auth-message");
const submitButton = document.getElementById("firebase-auth-submit");
const modeButton = document.getElementById("firebase-auth-mode");
const logoutButton = document.getElementById("firebase-logout");
const logoutMasterButton = document.getElementById("firebase-logout-master");
const userBar = document.getElementById("firebase-user-bar");
const userLabel = document.getElementById("firebase-user-label");
let mode = "login";

const initialPositions = {
  "Guerreiro": { x: 21, y: 13 },
  "Mago": { x: 20, y: 14 },
  "Ladino": { x: 22, y: 14 },
  "Clérigo": { x: 21, y: 15 }
};

function setMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? "text-sm text-red-300 mt-3" : "text-sm text-emerald-300 mt-3";
}
function showMode(nextMode) {
  mode = nextMode;
  const registering = mode === "register";
  nameWrap.classList.toggle("hidden", !registering);
  characterWrap.classList.toggle("hidden", !registering);
  nameInput.required = registering;
  submitButton.textContent = registering ? "Criar conta" : "Entrar";
  modeButton.textContent = registering ? "Já tenho conta — entrar" : "Criar uma conta";
  setMessage("");
}
modeButton.addEventListener("click", () => showMode(mode === "login" ? "register" : "login"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  modeButton.disabled = true;
  setMessage("Conectando ao Firebase…");
  try {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    let credential;
    if (mode === "register") {
      const displayName = nameInput.value.trim();
      const characterName = characterSelect.value;
      if (!Object.prototype.hasOwnProperty.call(initialPositions, characterName)) {
        throw new Error("Selecione um personagem válido.");
      }
      credential = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) await updateProfile(credential.user, { displayName });
      await set(ref(db, `users/${credential.user.uid}`), {
        role: "player",
        displayName: displayName || email.split("@")[0],
        createdAt: serverTimestamp()
      });
      await set(ref(db, `players/${credential.user.uid}`), {
        uid: credential.user.uid,
        characterName,
        map: "overworld",
        ...initialPositions[characterName],
        updatedAt: serverTimestamp()
      });
    } else {
      credential = await signInWithEmailAndPassword(auth, email, password);
    }
    await enterWithUser(credential.user);
  } catch (error) {
    const messages = {
      "auth/email-already-in-use": "Este e-mail já tem cadastro. Tente entrar.",
      "auth/invalid-email": "Digite um e-mail válido.",
      "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
      "auth/invalid-credential": "E-mail ou senha incorretos.",
      "auth/network-request-failed": "Falha de rede. Confira sua conexão.",
      "PERMISSION_DENIED": "O Firebase recusou o acesso. Confira as regras do Realtime Database.",
      "permission_denied": "O Firebase recusou o acesso. Confira as regras do Realtime Database."
    };
    setMessage(messages[error.code] || `Não foi possível autenticar: ${error.message}`, true);
  } finally {
    submitButton.disabled = false;
    modeButton.disabled = false;
  }
});

async function enterWithUser(user) {
  const profileRef = ref(db, `users/${user.uid}`);
  let profileSnap = await get(profileRef);
  if (!profileSnap.exists()) {
    // Contas antigas recebem apenas o papel de jogador. Nunca promover automaticamente a mestre.
    await set(profileRef, {
      role: "player",
      displayName: user.displayName || user.email?.split("@")[0] || "Jogador",
      createdAt: serverTimestamp()
    });
    profileSnap = await get(profileRef);
  }
  const profile = profileSnap.val() || {};
  const role = profile.role === "master" ? "master" : "player";
  window.firebaseUser = user;
  window.firebaseRole = role;
  window.firebaseCharacterName = null;

  const playerSnap = await get(ref(db, `players/${user.uid}`));
  if (playerSnap.exists()) {
    window.firebaseCharacterName = playerSnap.val()?.characterName || null;
  }

  userLabel.textContent = `${user.displayName || user.email} · ${role === "master" ? "Mestre" : "Jogador"}`;
  userBar.classList.remove("hidden");
  userBar.classList.add("flex");
  if (role === "master") {
    gate.classList.add("hidden");
    document.body.classList.remove("firebase-player-blocked");
    document.getElementById("firebase-login-card").classList.remove("hidden");
    document.getElementById("firebase-player-not-ready").classList.add("hidden");
    setMessage("");
  } else {
    // Modo simples de campanha compartilhada: jogadores autenticados recebem o mapa/sessão do mestre.
    gate.classList.add("hidden");
    document.getElementById("firebase-login-card").classList.add("hidden");
    document.getElementById("firebase-player-not-ready").classList.add("hidden");
    document.body.classList.add("firebase-player");
    const viewButton = document.getElementById("btn-view-mode");
    if (viewButton && !document.body.classList.contains("player-view")) viewButton.click();
    setMessage("");
  }
}
async function handleLogout() {
  try {
    await signOut(auth);
  } catch (error) {
    setMessage("Não foi possível sair da conta: " + (error.message || "erro desconhecido"), true);
  }
}
logoutButton?.addEventListener("click", handleLogout);
logoutMasterButton?.addEventListener("click", handleLogout);
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.firebaseUser = null;
    window.firebaseRole = null;
    window.firebaseCharacterName = null;
    document.body.classList.remove("firebase-player");
    if (document.body.classList.contains("player-view")) {
      document.getElementById("btn-view-mode")?.click();
    }
    userBar.classList.add("hidden");
    userBar.classList.remove("flex");
    document.getElementById("firebase-login-card").classList.remove("hidden");
    document.getElementById("firebase-player-not-ready").classList.add("hidden");
    gate.classList.remove("hidden");
    showMode("login");
    return;
  }
  try {
    await enterWithUser(user);
  } catch (error) {
    gate.classList.remove("hidden");
    setMessage(`Login realizado, mas não foi possível ler o perfil: ${error.message}`, true);
  }
});
showMode("login");
