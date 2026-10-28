// Configuração pública do Firebase para o projeto Vale-do-Corvo.
// Estes valores identificam o app web; a segurança depende das regras do Firebase.
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAhC9aq4-6eh37sRy7ME8bWhF7e1gTwMBI",
  authDomain: "vale-do-corvo.firebaseapp.com",
  projectId: "vale-do-corvo",
  storageBucket: "vale-do-corvo.firebasestorage.app",
  messagingSenderId: "469049461181",
  appId: "1:469049461181:web:3ee031cfbe6c6206e0ead4",
  measurementId: "G-7LF2B7HR8L"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
