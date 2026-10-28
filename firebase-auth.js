import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const gate = document.getElementById("auth-gate");
const form = document.getElementById("firebase-auth-form");
const emailInput = document.getElementById("firebase-email");
const passwordInput = document.getElementById("firebase-password");
const nameInput = document.getElementById("firebase-display-name");
const nameWrap = document.getElementById("firebase-name-wrap");
const message = document.getElementById("firebase-auth-message");
const submitButton = document.getElementById("firebase-auth-submit");
const modeButton = document.getElementById("firebase-auth-mode");
const logoutButton = document.getElementById("firebase-logout");
const userBar = document.getElementById("firebase-user-bar");
const userLabel = document.getElementById("firebase-user-label");
let mode = "login";
let currentUser = null;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? "text-sm text-red-300 mt-3" : "text-sm text-emerald-300 mt-3";
}
function showMode(nextMode) {
  mode = nextMode;
  const registering = mode === "register";
  nameWrap.classList.toggle("hidden", !registering);
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
      credential = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) await updateProfile(credential.user, { displayName });
      await setDoc(doc(db, "users", credential.user.uid), {
        role: "player",
        displayName: displayName || email.split("@")[0],
        createdAt: serverTimestamp()
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
      "permission-denied": "O Firebase recusou o acesso. Confira as regras do Firestore."
    };
    setMessage(messages[error.code] || `Não foi possível autenticar: ${error.message}`, true);
  } finally {
    submitButton.disabled = false;
    modeButton.disabled = false;
  }
});

async function enterWithUser(user) {
  currentUser = user;
  let profileRef = doc(db, "users", user.uid);
  let profileSnap = await getDoc(profileRef);
  if (!profileSnap.exists()) {
    // Contas antigas nunca ganham papel de mestre automaticamente.
    await setDoc(profileRef, {
      role: "player",
      displayName: user.displayName || user.email?.split("@")[0] || "Jogador",
      createdAt: serverTimestamp()
    });
    profileSnap = await getDoc(profileRef);
  }
  const role = profileSnap.data()?.role || "player";
  window.firebaseUser = user;
  window.firebaseRole = role;
  userLabel.textContent = `${user.displayName || user.email} · ${role === "master" ? "Mestre" : "Jogador"}`;
  userBar.classList.remove("hidden");
  userBar.classList.add("flex");
  if (role === "master") {
    gate.classList.add("hidden");
    document.body.classList.remove("firebase-player-blocked");
    setMessage("");
  } else {
    gate.classList.remove("hidden");
    document.getElementById("firebase-login-card").classList.add("hidden");
    document.getElementById("firebase-player-not-ready").classList.remove("hidden");
  }
}
logoutButton.addEventListener("click", async () => {
  try { await signOut(auth); } catch (error) { setMessage(error.message, true); }
});
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    window.firebaseUser = null;
    window.firebaseRole = null;
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
