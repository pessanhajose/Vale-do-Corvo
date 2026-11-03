import { auth, db } from "./firebase-config.js?v=2026-11-02.3";
import { signInAnonymously, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { ref, get, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

// Trava visual somente: este valor pode ser lido no JavaScript público.
const MASTER_PASSWORD = "0000";
const gate=document.getElementById("auth-gate"), form=document.getElementById("firebase-auth-form");
const nameInput=document.getElementById("firebase-display-name"), characterWrap=document.getElementById("firebase-character-wrap");
const characterSelect=document.getElementById("firebase-character-name"), roleSelect=document.getElementById("firebase-role");
const passwordWrap=document.getElementById("firebase-master-password-wrap"), passwordInput=document.getElementById("firebase-master-password");
const message=document.getElementById("firebase-auth-message"), submit=document.getElementById("firebase-auth-submit");
const userBar=document.getElementById("firebase-user-bar"), userLabel=document.getElementById("firebase-user-label");
const help=document.getElementById("firebase-master-device-help"), uidLabel=document.getElementById("firebase-device-uid");
const logout=document.getElementById("firebase-logout-master");
// Região inicial X15: longe do marcador central do Povoado Névoa-Fria.
// Cada conta recebe uma célula livre diferente, sempre fora da entrada da cripta.
const initialSpots=[
 {x:23,y:14},{x:24,y:14},{x:25,y:14},{x:22,y:15},
 {x:23,y:15},{x:24,y:15},{x:25,y:15},{x:22,y:16},
 {x:23,y:16},{x:24,y:16},{x:25,y:16},{x:23,y:17},
 {x:22,y:17},{x:24,y:17},{x:25,y:17}
];
const previousSpawnSpots=[
 {x:21,y:13},{x:20,y:14},{x:22,y:14},{x:21,y:15}
];
async function chooseInitialSpot(uid) {
 const snap=await get(ref(db,"players"));
 const occupied=new Set(Object.entries(snap.val()||{})
   .filter(([other,p])=>other!==uid&&p?.map==="overworld")
   .map(([,p])=>p.x+":"+p.y));
 return initialSpots.find(p=>!occupied.has(p.x+":"+p.y)) || initialSpots[0];
}
/** Migra apenas posições iniciais antigas e evita login no portal. */
async function ensureSafeOverworldPosition(user, playerSnap) {
 if(!user || !playerSnap.exists())return;
 const p=playerSnap.val();
 if(p?.map!=="overworld" || !Number.isInteger(p?.x) || !Number.isInteger(p?.y))return;
 const [versionSnap, entranceSnap]=await Promise.all([
   get(ref(db,"sessions/main/entranceVersion")),
   get(ref(db,"sessions/main/cryptEntrance"))
 ]);
 const entrance=versionSnap.val()==="AW32-v1" && entranceSnap.exists()
   ? entranceSnap.val() : {x:48,y:31};
 const onPortal=entrance && p.x===entrance.x && p.y===entrance.y;
 const legacySpawn=previousSpawnSpots.some(pos=>pos.x===p.x&&pos.y===p.y);
 if(!onPortal && !legacySpawn)return;
 const safe=await chooseInitialSpot(user.uid);
 await set(ref(db,"players/"+user.uid),{
   uid:user.uid,characterName:p.characterName,map:"overworld",
   x:safe.x,y:safe.y,updatedAt:serverTimestamp()
 });
}

function msg(t,err=false){message.textContent=t;message.className=err?"text-sm text-red-300 mt-3":"text-sm text-emerald-300 mt-3";}
function roleFields(){const master=roleSelect.value==="master";characterWrap.classList.toggle("hidden",master);passwordWrap.classList.toggle("hidden",!master);passwordInput.required=master;help.classList.add("hidden");}
roleSelect.addEventListener("change",roleFields);
form.addEventListener("submit",async e=>{
 e.preventDefault();submit.disabled=true;
 try{
  const name=nameInput.value.trim(), role=roleSelect.value;
  if(!name)throw new Error("Digite seu nome.");
  if(role==="master"&&passwordInput.value!==MASTER_PASSWORD)throw new Error("Senha do mestre incorreta.");
  if(role==="player"&&!["Guerreiro","Mago","Ladino","Clérigo"].includes(characterSelect.value))throw new Error("Selecione um personagem válido.");
  msg("Conectando ao Firebase…");
  const user=auth.currentUser||(await signInAnonymously(auth)).user;
  if(user.displayName!==name)await updateProfile(user,{displayName:name});
  const profileRef=ref(db,"users/"+user.uid); let snap;
  try{
   snap=await get(profileRef);
   await set(profileRef,{role:role==="master"?"master":"player",displayName:name,createdAt:snap.exists()?(snap.val().createdAt||serverTimestamp()):serverTimestamp()});
   if(role==="player"){
    const pRef=ref(db,"players/"+user.uid),p=await get(pRef);
    if(!p.exists()){
     const safe=await chooseInitialSpot(user.uid);
     const initial={uid:user.uid,characterName:characterSelect.value,map:"overworld",...safe,updatedAt:serverTimestamp()};
     await set(pRef,initial);
    }
    await ensureSafeOverworldPosition(user,await get(pRef));
   }
  }catch(err){
   if(role==="master"){uidLabel.textContent="UID: "+user.uid;help.classList.remove("hidden");throw new Error("Dispositivo mestre não autorizado. Adicione masters/"+user.uid+" com valor true em Realtime Database → Dados e tente novamente. UID: "+user.uid);}
   throw err;
  }
  await enter(user);
  // A autenticação pode ter iniciado a presença antes de o nome ser definido.
  // Reenvia o nome recém-salvo assim que o formulário termina.
  window.ValeCorvoSync?.refreshPresence?.();
 }catch(err){msg(err.message||"Não foi possível entrar.",true);}
 finally{submit.disabled=false;}
});
async function enter(user){
 const s=await get(ref(db,"users/"+user.uid)); if(!s.exists())throw new Error("Perfil não encontrado.");
 const profile=s.val(),role=profile.role==="master"?"master":"player";
 window.firebaseUser=user;window.firebaseRole=role;window.firebaseCharacterName=null;
 const p=await get(ref(db,"players/"+user.uid));
 if(p.exists()){
  window.firebaseCharacterName=p.val()?.characterName||null;
  if(role==="player")await ensureSafeOverworldPosition(user,p);
 }
 userLabel.textContent=(user.displayName||profile.displayName||"Jogador")+" · "+(role==="master"?"Mestre":"Jogador");
 // Para sessões retomadas depois de atualizar o site, republica o nome salvo.
 window.ValeCorvoSync?.refreshPresence?.();
 userBar.classList.remove("hidden");userBar.classList.add("flex");gate.classList.add("hidden");
 if(role==="master"){document.body.classList.remove("firebase-player");}
 else{
  document.body.classList.add("firebase-player");
  if(!document.getElementById("firebase-player-ui-style")){const st=document.createElement("style");st.id="firebase-player-ui-style";st.textContent="body.firebase-player #btn-view-mode{display:none!important}";document.head.appendChild(st);}
  const b=document.getElementById("btn-view-mode");if(b&&!document.body.classList.contains("player-view"))b.click();
 }
}
logout?.addEventListener("click",async()=>{await signOut(auth);gate.classList.remove("hidden");userBar.classList.add("hidden");userBar.classList.remove("flex");window.firebaseUser=null;window.firebaseRole=null;window.firebaseCharacterName=null;});
onAuthStateChanged(auth,async user=>{
 if(!user){window.firebaseUser=null;window.firebaseRole=null;window.firebaseCharacterName=null;userBar.classList.add("hidden");userBar.classList.remove("flex");gate.classList.remove("hidden");return;}
 try{const s=await get(ref(db,"users/"+user.uid));if(s.exists())await enter(user);else gate.classList.remove("hidden");}
 catch(err){gate.classList.remove("hidden");msg("Não foi possível carregar o perfil: "+err.message,true);}
});
roleFields();
