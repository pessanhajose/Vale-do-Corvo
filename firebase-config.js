// Configuração pública do Firebase para o projeto Vale-do-Corvo.
// A segurança é aplicada pelas regras do Realtime Database, nunca por esconder esta configuração.
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAhC9aq4-6eh37sRy7ME8bWhF7e1gTwMBI",
  authDomain: "vale-do-corvo.firebaseapp.com",
  databaseURL: "https://vale-do-corvo-default-rtdb.firebaseio.com",
  projectId: "vale-do-corvo",
  storageBucket: "vale-do-corvo.firebasestorage.app",
  messagingSenderId: "469049461181",
  appId: "1:469049461181:web:3ee031cfbe6c6206e0ead4",
  measurementId: "G-7LF2B7HR8L"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app, firebaseConfig.databaseURL);
