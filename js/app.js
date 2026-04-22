import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, onValue, set, remove, onDisconnect, get, query, limitToLast, orderByKey } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCpnXOFauAqnuHrUlNg5WCmNi9FRQ1cgVY",
  authDomain: "my-chat-bdc87.firebaseapp.com",
  databaseURL: "https://my-chat-bdc87-default-rtdb.firebaseio.com",
  projectId: "my-chat-bdc87",
  storageBucket: "my-chat-bdc87.firebasestorage.app",
  messagingSenderId: "614734033121",
  appId: "1:614734033121:web:44b93bb896418f6cbb87a0"
};

const OWNER_HASH = "8030dd20b0b72a1292efba460af0374d7ee13ccee9713a72b67161ade538e441";
async function hashStr(s){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function checkOwnerCode(input){ return (await hashStr(input))===OWNER_HASH; }

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Firebase Rules test — sayfa yüklenir yüklenmez kontrol et
setTimeout(async () => {
  try {
    await set(ref(db, '.info/test'), null);
  } catch(e) {
    if(e.message && e.message.includes('PERMISSION_DENIED')) {
      // Sayfanın üstünde kırmızı banner göster
      const banner = document.createElement('div');
      banner.id = 'firebaseBanner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#ef476f;color:#fff;text-align:center;padding:10px 16px;font-family:Nunito,sans-serif;font-size:0.85rem;font-weight:800;';
      banner.innerHTML = '⚠️ Firebase izni yok! <a href="https://console.firebase.google.com" target="_blank" style="color:#fff;text-decoration:underline">console.firebase.google.com</a> → Realtime Database → Rules → <b>".write":true</b> → Publish';
      document.body.prepend(banner);
    }
  }
}, 2000);

const EMOJIS = ['🧑','👩','👦','👧','🧒','👱','🧔','👨‍🎓','👩‍🎓','🦸','🦊','🐼','🐯','🐸','🦄','🐧','🦋','🌟'];
const REACTION_EMOJIS = ['😂','😍','🔥','👍','❤️','😮','😢','🥳','💯','🤔','😎','👋','🎉','💪','✨','🤗','😴','🙈'];
const GRAD_COLORS = ['#ff6b35','#ffd700','#3ecfcf','#7b5ea7','#ef476f','#84dcc6','#a0c4ff','#06d6a0','#ff99c8','#ffffff','#ff4d4d','#00cfff'];
const FUN_LINKS = ['https://www.geoguessr.com','https://neal.fun/infinite-craft/','https://skribbl.io','https://garticphone.com','https://www.sporcle.com','https://typeracer.com','https://lichess.org','https://2048.la','https://www.coolmathgames.com','https://poki.com','https://wordletr.net','https://www.chess.com/play/computer'];

let currentUser = null, currentChannel = 'genel', typingTimer = null;
let dmMode = false, currentDmRoom = null, unsubDmMessages = null, unsubDmRooms = null;
let dmRoomsCache = {}, onlineUsersCache = {};
const MSG_TIMESTAMPS = [];
const RATE_LIMIT_COUNT = 4;
const RATE_LIMIT_WINDOW = 5000;
const RATE_LIMIT_COOLDOWN = 8000;
let rateLimitedUntil = 0;

const savedLogin = JSON.parse(localStorage.getItem('chatLogin')||'null');
if(savedLogin){
  setTimeout(()=>{
    document.getElementById('nameInput').value=savedLogin.name||'';
    document.getElementById('bioInput').value=savedLogin.bio||'';
    if(savedLogin.role==='owner'){ document.querySelector('.role-opt[data-role="owner"]').click(); }
    if(savedLogin.avatarIdx!=null){
      const btns=document.querySelectorAll('.avatar-btn');
      if(btns[savedLogin.avatarIdx]) btns[savedLogin.avatarIdx].click();
    }
  },50);
}

let myOnlineRef = null, myTypingRef = null;
let loginPhotoData = null, editPhotoData = null;
let gradC1 = GRAD_COLORS[0], gradC2 = GRAD_COLORS[2];
let slowMode = false;
let unsubMessages=null,unsubPinned=null,unsubSlowMode=null,unsubAnnounce=null,unsubTyping=null;
let presenceInterval=null;
let localDeleted = new Set(JSON.parse(localStorage.getItem('localDeleted')||'[]'));

// ─── YARDIMCI FONKSİYONLAR ───
window.showToast = (msg, type='info') => {
  const c = document.getElementById('toastContainer') || (() => {
    const el = document.createElement('div');
    el.id = 'toastContainer';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(el);
    return el;
  })();
  const t = document.createElement('div');
  const bg = type==='error' ? 'rgba(239,71,111,0.9)' : type==='success' ? 'rgba(35,165,89,0.9)' : 'rgba(34,33,58,0.9)';
  t.style.cssText = `background:${bg};backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;padding:10px 18px;border-radius:12px;font-weight:700;font-size:0.85rem;box-shadow:0 8px 24px rgba(0,0,0,0.3);animation:toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1);`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'all 0.3s ease';
    t.style.opacity = '0';
    t.style.transform = 'translateY(10px) scale(0.9)';
    setTimeout(()=>t.remove(), 300);
  }, 3000);
};

function compressImage(file, maxWidth = 800, quality = 0.6) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = ev => resolve(ev.target.result);
      r.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════
//   WebRTC — Düzeltilmiş & Güvenilir Versiyon
//   Sinyal: Firebase vc_sig/{channelId}/{to}/{from}
// ═══════════════════════════════════════════
const ICE_SERVERS = {
  iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'},
    {urls:'stun:stun2.l.google.com:19302'},
  ]
};

let vcState = {
  currentChannel: null,
  localStream: null,
  peers: {},          // { peerName: RTCPeerConnection }
  micMuted: false,
  camOff: true,
  signalUnsub: null,
  membersUnsub: null,
  pendingCandidates: {}, // { peerName: [candidate,...] }
};

// ── PC oluştur ──
function createPC(peerName) {
  if (vcState.peers[peerName]) {
    try { vcState.peers[peerName].close(); } catch(e){}
  }
  const pc = new RTCPeerConnection(ICE_SERVERS);
  vcState.peers[peerName] = pc;
  vcState.pendingCandidates[peerName] = [];

  pc.onnegotiationneeded = () => {
    sendOffer(peerName);
  };

  // Yerel track'leri ekle
  if (vcState.localStream) {
    vcState.localStream.getTracks().forEach(t => {
      try { pc.addTrack(t, vcState.localStream); } catch(e){}
    });
  }

  // ICE → Firebase
  pc.onicecandidate = ({candidate}) => {
    if (!candidate || !vcState.currentChannel) return;
    const path = `vc_sig/${vcState.currentChannel}/${peerName}/${currentUser.name}`;
    push(ref(db, path+'/ice'), { c: JSON.stringify(candidate), ts: Date.now() });
  };

  // Uzak stream
  pc.ontrack = e => {
    if (e.streams && e.streams[0]) {
      upsertVideoTile(peerName, e.streams[0]);
    }
  };

  pc.onconnectionstatechange = () => {
    if (['failed','disconnected','closed'].includes(pc.connectionState)) {
      removeVideoTile(peerName);
      delete vcState.peers[peerName];
    }
  };

  pc.onsignalingstatechange = async () => {
    // Remote desc set olduktan sonra bekleyen ICE adaylarını uygula
    if (pc.remoteDescription && vcState.pendingCandidates[peerName]?.length) {
      for (const c of vcState.pendingCandidates[peerName]) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){}
      }
      vcState.pendingCandidates[peerName] = [];
    }
  };

  return pc;
}

// ── Video tile oluştur / güncelle ──
function upsertVideoTile(name, stream, userInfo) {
  const grid = document.getElementById('videoGrid');
  if (!grid) return;
  let tile = document.getElementById('vctile_'+name);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = 'vctile_'+name;
    // Avatar div (kamera kapalıyken)
    const av = document.createElement('div');
    av.className = 'video-tile-avatar';
    av.id = 'vctav_'+name;
    const avImg = document.createElement('div');
    avImg.className = 'video-tile-av-img';
    avImg.id = 'vctavimg_'+name;
    const u = userInfo || {};
    if (u.photoData) { avImg.innerHTML = `<img src="${u.photoData}" alt="pp"/>`; }
    else { avImg.textContent = u.avatar || name.charAt(0).toUpperCase(); }
    const avName = document.createElement('div');
    avName.className = 'video-tile-av-name';
    avName.textContent = name === currentUser?.name ? '🟢 Sen' : name;
    av.appendChild(avImg); av.appendChild(avName); tile.appendChild(av);
    // Video elementi
    const vid = document.createElement('video');
    vid.autoplay = true; vid.playsInline = true;
    vid.muted = (name === currentUser?.name);
    vid.id = 'vcvid_'+name;
    tile.appendChild(vid);
    // İsim etiketi
    const lbl = document.createElement('div');
    lbl.className = 'video-tile-label';
    lbl.innerHTML = `<span>${name === currentUser?.name ? '🟢 Sen' : '🎙️ '+name}</span>`;
    tile.appendChild(lbl);
    grid.appendChild(tile);
  }
  const vid = document.getElementById('vcvid_'+name);
  const avDiv = document.getElementById('vctav_'+name);
  if (stream && vid) {
    if (vid.srcObject !== stream) vid.srcObject = stream;
    const hasVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
    vid.style.display = 'block';
    vid.style.opacity = hasVideo ? '1' : '0';
    if (avDiv) avDiv.style.display = hasVideo ? 'none' : 'flex';
    vid.play().catch(e => console.warn('video play error', e));
  }
}

function updateLocalTile() {
  if (!currentUser) return;
  upsertVideoTile(currentUser.name, vcState.localStream, currentUser);
  const tile = document.getElementById('vctile_'+currentUser.name);
  if (!tile) return;
  let mi = tile.querySelector('.video-tile-muted');
  if (vcState.micMuted) {
    if (!mi) { mi = document.createElement('div'); mi.className = 'video-tile-muted'; mi.textContent = '🔇'; tile.appendChild(mi); }
  } else { if (mi) mi.remove(); }
}

function removeVideoTile(name) {
  const t = document.getElementById('vctile_'+name);
  if (t) { t.style.cssText += 'opacity:0;transform:scale(0.9);transition:all 0.3s;'; setTimeout(()=>t.remove(), 300); }
}

// ── SES EFEKTLERİ ──
let _audioCtx = null;
function getACtx() { if (!_audioCtx) _audioCtx = new (window.AudioContext||window.webkitAudioContext)(); return _audioCtx; }
function playTone(type) {
  try {
    const ctx = getACtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    const t = ctx.currentTime;
    if (type==='join') {
      osc.type='sine'; osc.frequency.setValueAtTime(440,t); osc.frequency.setValueAtTime(660,t+0.12);
      gain.gain.setValueAtTime(0.25,t); gain.gain.exponentialRampToValueAtTime(0.001,t+0.35);
      osc.start(t); osc.stop(t+0.35);
    } else if (type==='leave') {
      osc.type='sine'; osc.frequency.setValueAtTime(660,t); osc.frequency.setValueAtTime(440,t+0.12);
      gain.gain.setValueAtTime(0.25,t); gain.gain.exponentialRampToValueAtTime(0.001,t+0.35);
      osc.start(t); osc.stop(t+0.35);
    } else if (type==='mute') {
      osc.type='sine'; osc.frequency.setValueAtTime(300,t);
      gain.gain.setValueAtTime(0.2,t); gain.gain.exponentialRampToValueAtTime(0.001,t+0.18);
      osc.start(t); osc.stop(t+0.18);
    } else if (type==='unmute') {
      osc.type='sine'; osc.frequency.setValueAtTime(500,t);
      gain.gain.setValueAtTime(0.2,t); gain.gain.exponentialRampToValueAtTime(0.001,t+0.18);
      osc.start(t); osc.stop(t+0.18);
    } else if (type==='cam_on') {
      osc.type='triangle'; osc.frequency.setValueAtTime(800,t);
      gain.gain.setValueAtTime(0.15,t); gain.gain.exponentialRampToValueAtTime(0.001,t+0.2);
      osc.start(t); osc.stop(t+0.2);
    } else if (type==='cam_off') {
      osc.type='triangle'; osc.frequency.setValueAtTime(400,t);
      gain.gain.setValueAtTime(0.15,t); gain.gain.exponentialRampToValueAtTime(0.001,t+0.15);
      osc.start(t); osc.stop(t+0.15);
    }
  } catch(e) {}
}

// ── Offer gönder ──
async function sendOffer(peerName) {
  const pc = vcState.peers[peerName];
  if (!pc) return;
  try {
    const offer = await pc.createOffer();
    if (pc.signalingState !== 'stable') return;
    await pc.setLocalDescription(offer);
    const path = `vc_sig/${vcState.currentChannel}/${peerName}/${currentUser.name}`;
    await set(ref(db, path+'/offer'), { sdp: JSON.stringify(pc.localDescription), ts: Date.now() });
  } catch(e) { console.warn('sendOffer err', e); }
}

// ── Sinyal dinle ──
function listenSignals(channelId) {
  if (vcState.signalUnsub) { vcState.signalUnsub(); vcState.signalUnsub = null; }
  const myPath = ref(db, `vc_sig/${channelId}/${currentUser.name}`);
  vcState.signalUnsub = onValue(myPath, async snap => {
    const senders = snap.val();
    if (!senders) return;
    for (const [senderName, data] of Object.entries(senders)) {
      if (!data) continue;
      if (data.offer) {
        let pc = vcState.peers[senderName];
        if (!pc) pc = createPC(senderName);
        try {
          if (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(data.offer.sdp)));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const ansPath = `vc_sig/${channelId}/${senderName}/${currentUser.name}`;
            await set(ref(db, ansPath+'/answer'), { sdp: JSON.stringify(pc.localDescription), ts: Date.now() });
          }
        } catch(e) { console.warn('offer handle err', e); }
        remove(ref(db, `vc_sig/${channelId}/${currentUser.name}/${senderName}/offer`));
      }
      if (data.answer) {
        const pc = vcState.peers[senderName];
        if (pc && pc.signalingState === 'have-local-offer') {
          try { await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(data.answer.sdp))); } catch(e) {}
        }
        remove(ref(db, `vc_sig/${channelId}/${currentUser.name}/${senderName}/answer`));
      }
      if (data.ice) {
        const pc = vcState.peers[senderName];
        for (const [iceKey, iceData] of Object.entries(data.ice)) {
          if (!iceData?.c) continue;
          if (!pc) continue;
          try {
            const cand = new RTCIceCandidate(JSON.parse(iceData.c));
            if (pc.remoteDescription) { await pc.addIceCandidate(cand); }
            else { vcState.pendingCandidates[senderName] = vcState.pendingCandidates[senderName]||[]; vcState.pendingCandidates[senderName].push(JSON.parse(iceData.c)); }
          } catch(e) {}
          remove(ref(db, `vc_sig/${channelId}/${currentUser.name}/${senderName}/ice/${iceKey}`));
        }
      }
    }
  });
}

// ── Ses kanalına katıl ──
window.joinVoiceChannel = async (channelId) => {
  if (!currentUser) return;
  if (vcState.currentChannel === channelId) { openVcOverlay(); return; }
  if (vcState.currentChannel) await leaveVoiceChannel(true);
  try {
    vcState.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    vcState.micMuted = false; vcState.camOff = true;
  } catch(e) { window.showToast('❌ Mikrofon erişimi reddedildi.', 'error'); return; }
  playTone('join');
  vcState.currentChannel = channelId;
  const myVcRef = ref(db, `vc_members/${channelId}/${currentUser.name}`);
  await set(myVcRef, { name:currentUser.name, avatar:currentUser.avatar||'🧑', photoData:currentUser.photoData||null, micMuted:false, camOff:true, ts:Date.now() });
  onDisconnect(myVcRef).remove();
  await set(ref(db, `vc_sig/${channelId}/${currentUser.name}`), null);
  updateLocalTile();
  listenSignals(channelId);
  const snap = await get(ref(db, `vc_members/${channelId}`));
  const members = snap.val() || {};
  for (const name of Object.keys(members)) {
    if (name !== currentUser.name) { createPC(name); await sendOffer(name); }
  }
  updateVcStatusBar(channelId);
  updateVcButtons();
  openVcOverlay();
};

// ── Mikrofon toggle ──
window.vcToggleMic = () => {
  if (!vcState.localStream) return;
  vcState.micMuted = !vcState.micMuted;
  vcState.localStream.getAudioTracks().forEach(t => t.enabled = !vcState.micMuted);
  playTone(vcState.micMuted ? 'mute' : 'unmute');
  if (vcState.currentChannel) set(ref(db, `vc_members/${vcState.currentChannel}/${currentUser.name}/micMuted`), vcState.micMuted);
  updateVcButtons(); updateLocalTile();
};

// ── Kamera toggle ──
window.vcToggleCam = async () => {
  if (!vcState.currentChannel) return;
  vcState.camOff = !vcState.camOff;
  if (!vcState.camOff) {
    try {
      const cs = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      const vt = cs.getVideoTracks()[0];
      vcState.localStream.addTrack(vt);
      for (const pc of Object.values(vcState.peers)) {
        const sender = pc.getSenders().find(s => s.track?.kind==='video');
        if (sender) sender.replaceTrack(vt); else pc.addTrack(vt, vcState.localStream);
      }
      playTone('cam_on');
    } catch(e) { window.showToast('❌ Kamera erişimi reddedildi.', 'error'); vcState.camOff = true; }
  } else {
    vcState.localStream.getVideoTracks().forEach(t=>{ t.stop(); try{vcState.localStream.removeTrack(t);}catch(e){} });
    for (const pc of Object.values(vcState.peers)) {
      const sender = pc.getSenders().find(s => s.track?.kind==='video');
      if (sender) sender.replaceTrack(null).catch(()=>{});
    }
    playTone('cam_off');
  }
  if (vcState.currentChannel) set(ref(db, `vc_members/${vcState.currentChannel}/${currentUser.name}/camOff`), vcState.camOff);
  updateVcButtons(); updateLocalTile();
};

// ── VC'den çık ──
window.leaveVoiceChannel = async (silent=false) => {
  if (!vcState.currentChannel) return;
  const ch = vcState.currentChannel;
  if (!silent) playTone('leave');
  for (const pc of Object.values(vcState.peers)) { try{pc.close();}catch(e){} }
  vcState.peers = {}; vcState.pendingCandidates = {};
  if (vcState.localStream) { vcState.localStream.getTracks().forEach(t=>t.stop()); vcState.localStream = null; }
  if (vcState.signalUnsub) { vcState.signalUnsub(); vcState.signalUnsub = null; }
  remove(ref(db, `vc_members/${ch}/${currentUser.name}`));
  remove(ref(db, `vc_sig/${ch}/${currentUser.name}`));
  vcState.currentChannel = null; vcState.micMuted = false; vcState.camOff = true;
  document.getElementById('videoGrid').innerHTML = '';
  closeVcOverlay();
  // Status bar tamamen sıfırla
  const bar = document.getElementById('vcStatusBar');
  if (bar) bar.classList.remove('visible');
  const mb2 = document.getElementById('vcMicBtn'); if (mb2) { mb2.classList.remove('active'); mb2.textContent = '🎙️ Mic'; }
  const cb2 = document.getElementById('vcCamBtn'); if (cb2) { cb2.classList.remove('active'); cb2.textContent = '📷 Kamera'; }
  if (currentUser && !silent) {
    // No system message for leaving voice channel
  }
};

function updateVcStatusBar(channelId) {
  document.getElementById('vcStatusBar').classList.add('visible');
  document.getElementById('vcStatusName').textContent = '🔊 ' + channelId;
  document.getElementById('vcOverlayTitle').textContent = channelId;
}

function updateVcButtons() {
  const mm = vcState.micMuted, co = vcState.camOff;
  const mb = document.getElementById('vcMicBtn'); const cb = document.getElementById('vcCamBtn');
  if (mb) { mb.classList.toggle('active',mm); mb.textContent = mm?'🔇 Sessiz':'🎙️ Mic'; }
  if (cb) { cb.classList.toggle('active',co); cb.textContent = co?'📷 Kamera':'📹 Açık'; }
  const om = document.getElementById('vcOverlayMicBtn'); const oc = document.getElementById('vcOverlayCamBtn');
  if (om) { om.classList.toggle('active',mm); om.querySelector('.vc-btn-icon').textContent=mm?'🔇':'🎙️'; const t=om.childNodes[1];if(t)t.textContent=mm?' Sessiz':' Mikrofon'; }
  if (oc) { oc.classList.toggle('active',co); oc.querySelector('.vc-btn-icon').textContent=co?'📷':'📹'; const t=oc.childNodes[1];if(t)t.textContent=co?' Kamera':' Açık'; }
}

window.openVcOverlay = () => { document.getElementById('vcOverlay').classList.add('visible'); updateLocalTile(); };
window.closeVcOverlay = () => { document.getElementById('vcOverlay').classList.remove('visible'); };

// VC kanallarını render et — veri doğrudan geliyor
// VC kanallarını render et — veri doğrudan geliyor
function renderVcChannels(vcData, membersData) {
  const list = document.getElementById('vcChannelList');
  if (!list) return;
  list.innerHTML = '';
  if (!vcData) {
    list.innerHTML = '<div style="padding:4px 8px;font-size:0.72rem;color:var(--muted)">Henüz kanal yok</div>';
    return;
  }
  const channels = Object.values(vcData).sort((a,b) => (a.order||0) - (b.order||0));
  channels.forEach(ch => {
    const isJoined = vcState.currentChannel === ch.id;
    const item = document.createElement('div');
    item.className = 'vc-channel-item' + (isJoined ? ' vc-joined' : '');

    // Silme butonu (owner)
    let delBtn = '';
    if (currentUser?.role === 'owner') {
      delBtn = `<span class="ch-del" onclick="deleteVcChannel('${ch.id}',event)" style="margin-left:auto;opacity:0;font-size:11px;color:#ef476f;transition:opacity 0.15s">✕</span>`;
    }
    item.innerHTML = `<span class="vc-icon">🔊</span><span style="flex:1">${ch.name}</span>${delBtn}`;
    item.style.cssText = 'display:flex;align-items:center;';
    item.onmouseenter = () => { const d = item.querySelector('.ch-del'); if(d) d.style.opacity='1'; };
    item.onmouseleave = () => { const d = item.querySelector('.ch-del'); if(d) d.style.opacity='0'; };
    item.onclick = (e) => { if(e.target.classList.contains('ch-del')) return; joinVoiceChannel(ch.id); };
    list.appendChild(item);

    // Kanaldaki üyeleri — profil fotoğrafı + isim ile göster
    const members = (membersData && membersData[ch.id]) || {};
    const names = Object.keys(members);
    if (names.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'vc-member-chips';
      names.forEach(n => {
        const m = members[n];
        const chip = document.createElement('div');
        chip.className = 'vc-chip' + (m.micMuted ? ' muted' : '');

        // Avatar (foto veya emoji)
        const avEl = document.createElement('div');
        avEl.className = 'vc-chip-av';
        if (m.photoData) {
          avEl.innerHTML = `<img src="${m.photoData}" alt="pp"/>`;
        } else {
          avEl.textContent = m.avatar || n.charAt(0).toUpperCase();
        }

        // Mikrofon ikonu
        const micEl = document.createElement('span');
        micEl.className = 'vc-mic-icon';
        micEl.textContent = m.micMuted ? '🔇' : '🎙️';

        // İsim
        const nameEl = document.createElement('span');
        nameEl.className = 'vc-chip-name';
        nameEl.textContent = n;

        chip.appendChild(avEl);
        chip.appendChild(micEl);
        chip.appendChild(nameEl);
        chips.appendChild(chip);
      });
      list.appendChild(chips);
    }
  });
}

window.deleteVcChannel = (id, e) => {
  if (e) e.stopPropagation();
  if (currentUser?.role !== 'owner') return;
  if (vcState.currentChannel === id) leaveVoiceChannel(true);
  remove(ref(db, `vc_channels/${id}`));
  remove(ref(db, `vc_members/${id}`));
  remove(ref(db, `vc_sig/${id}`));
};

// VC kanalı oluştur
window.openAddVoiceChannel = () => {
  if (!currentUser) { alert('Önce giriş yapmalısın!'); return; }
  const inp = document.getElementById('newVcName');
  if (inp) inp.value = '';
  document.getElementById('addVcModal').classList.remove('hidden');
  setTimeout(() => { if (inp) inp.focus(); }, 150);
};

function doCreateVoiceChannel() {
  const inp = document.getElementById('newVcName');
  const rawName = inp ? inp.value.trim() : '';
  if (!rawName) { if(inp){ inp.style.borderColor='#ef476f'; setTimeout(()=>inp.style.borderColor='',1500); } return; }
  const id = rawName.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-ğüşıöç]/g, '')
    .substring(0, 30) || ('vc-' + Date.now());
  set(ref(db, `vc_channels/${id}`), {
    id, name: rawName, order: Date.now(), createdBy: currentUser.name
  }).then(() => {
    closeModal('addVcModal');
  }).catch(err => {
    alert('Kanal oluşturulamadı: ' + err.message);
  });
}
window.createVoiceChannel = doCreateVoiceChannel;

// Buton event listener'ları — DOM hazır olunca bağla
function bindVcModalButtons() {
  // Modal butonları
  const createBtn = document.getElementById('createVcBtn');
  const cancelBtn = document.getElementById('cancelVcBtn');
  const inp = document.getElementById('newVcName');
  if (createBtn) createBtn.onclick = doCreateVoiceChannel;
  if (cancelBtn) cancelBtn.onclick = () => closeModal('addVcModal');
  if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') doCreateVoiceChannel(); };

  // Sidebar + butonu
  const addVcBtn = document.getElementById('addVcBtn');
  if (addVcBtn) addVcBtn.onclick = () => window.openAddVoiceChannel();

  // Sidebar kontrol butonları
  const micBtn = document.getElementById('vcMicBtn');
  const camBtn = document.getElementById('vcCamBtn');
  const expandBtn = document.getElementById('vcExpandBtn');
  const leaveBtn = document.getElementById('vcLeaveBtn');
  if (micBtn) micBtn.onclick = () => vcToggleMic();
  if (camBtn) camBtn.onclick = () => vcToggleCam();
  if (expandBtn) expandBtn.onclick = () => openVcOverlay();
  if (leaveBtn) leaveBtn.onclick = () => leaveVoiceChannel();

  // Overlay kontrol butonları
  const omBtn = document.getElementById('vcOverlayMicBtn');
  const ocBtn = document.getElementById('vcOverlayCamBtn');
  const ominBtn = document.getElementById('vcOverlayMinBtn');
  const oleaveBtn = document.getElementById('vcOverlayLeaveBtn');
  if (omBtn) omBtn.onclick = () => vcToggleMic();
  if (ocBtn) ocBtn.onclick = () => vcToggleCam();
  if (ominBtn) ominBtn.onclick = () => closeVcOverlay();
  if (oleaveBtn) oleaveBtn.onclick = () => leaveVoiceChannel();
}

// Firebase VC kanallarını dinle — gerçek zamanlı
let vcChannelsCache = null;
let vcMembersCache = null;
function listenVcChannels() {
  onValue(ref(db, 'vc_channels'), snap => {
    vcChannelsCache = snap.val();
    renderVcChannels(vcChannelsCache, vcMembersCache);
  }, err => {
    // Firebase rules hatası
    const list = document.getElementById('vcChannelList');
    if (list) list.innerHTML = '<div style="padding:4px 8px;font-size:0.68rem;color:#ef476f;font-weight:700">⚠️ Firebase izni yok!<br>Console → Rules → yayınla</div>';
  });
  onValue(ref(db, 'vc_members'), snap => {
    vcMembersCache = snap.val();
    renderVcChannels(vcChannelsCache, vcMembersCache);
  });
}

// ─── PP UPLOAD ───
document.getElementById('photoFileInput').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  loginPhotoData = await compressImage(file, 200, 0.7);
  const prev = document.getElementById('ppPreviewBig');
  prev.innerHTML = `<img src="${loginPhotoData}" alt="pp"/>`;
  document.getElementById('ppUploadArea').classList.add('has-photo');
  document.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
  e.target.value = '';
};

// ─── AVATAR PICKER ───
const avatarPicker = document.getElementById('avatarPicker');
EMOJIS.forEach((e, i) => {
  const btn = document.createElement('button');
  btn.className = 'avatar-btn' + (i===0?' selected':'');
  btn.textContent = e; btn.type = 'button';
  btn.onclick = () => {
    avatarPicker.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    loginPhotoData = null;
    document.getElementById('ppPreviewBig').innerHTML = '📷';
    document.getElementById('ppUploadArea').classList.remove('has-photo');
  };
  avatarPicker.appendChild(btn);
});

// ─── EMOJI PICKER ───
const emojiPicker = document.getElementById('emojiPicker');
REACTION_EMOJIS.forEach(e => {
  const s = document.createElement('span'); s.className='emoji-option'; s.textContent=e;
  s.onclick=()=>{ const i=document.getElementById('msgInput'); i.value+=e; i.focus(); emojiPicker.classList.add('hidden'); };
  emojiPicker.appendChild(s);
});
window.toggleEmojiPicker=()=>emojiPicker.classList.toggle('hidden');
document.addEventListener('click',e=>{ if(!emojiPicker.contains(e.target)&&!e.target.classList.contains('icon-btn')) emojiPicker.classList.add('hidden'); });

// ─── FILE / IMAGE ATTACH ───
let pendingFiles = [];
function getFileIcon(type){
  if(type.startsWith('image/')) return '🖼️';
  if(type==='application/pdf') return '📄';
  if(type.includes('word')||type.includes('document')) return '📝';
  if(type.includes('zip')||type.includes('rar')||type.includes('7z')) return '🗜️';
  if(type.includes('audio')) return '🎵';
  if(type.includes('video')) return '🎬';
  if(type.includes('spreadsheet')||type.includes('excel')) return '📊';
  return '📁';
}
function formatBytes(b){if(b<1024)return b+'B';if(b<1048576)return (b/1024).toFixed(1)+'KB';return (b/1048576).toFixed(1)+'MB';}

function refreshAttachBar(){
  const bar=document.getElementById('attachBar');
  const inner=document.getElementById('attachBarInner');
  const inputBox=document.querySelector('.input-box');
  if(pendingFiles.length===0){bar.classList.add('hidden');inputBox.classList.remove('has-attach');inner.innerHTML='<button class="attach-bar-send" onclick="sendAttachments()">📤 Gönder</button>';return;}
  bar.classList.remove('hidden');inputBox.classList.add('has-attach');inner.innerHTML='';
  pendingFiles.forEach((f,i)=>{
    const item=document.createElement('div');item.className='attach-item';
    if(f.isImage){const img=document.createElement('img');img.className='attach-img-thumb';img.src=f.data;item.appendChild(img);}
    else{const icon=document.createElement('span');icon.className='attach-item-icon';icon.textContent=getFileIcon(f.type);item.appendChild(icon);}
    const info=document.createElement('div');info.className='attach-item-info';
    const nm=document.createElement('div');nm.className='attach-item-name';nm.textContent=f.name;
    const sz=document.createElement('div');sz.className='attach-item-size';sz.textContent=formatBytes(f.size);
    info.appendChild(nm);info.appendChild(sz);item.appendChild(info);
    const rm=document.createElement('button');rm.className='attach-remove';rm.textContent='✕';
    rm.onclick=()=>{pendingFiles.splice(i,1);refreshAttachBar();};
    item.appendChild(rm);inner.appendChild(item);
  });
  const sendBtn=document.createElement('button');sendBtn.className='attach-bar-send';sendBtn.textContent='📤 Gönder ('+pendingFiles.length+')';
  sendBtn.onclick=sendAttachments;inner.appendChild(sendBtn);
}

window.sendAttachments=async()=>{
  if(!currentUser||pendingFiles.length===0) return;
  for(const f of pendingFiles){
    try{
      const base={author:currentUser.name,avatar:currentUser.avatar,role:currentUser.role,
        title:currentUser.title||'',gradC1:currentUser.gradC1||'',gradC2:currentUser.gradC2||'',
        photoData:currentUser.photoData||null,ts:Date.now()};
      if(f.isImage){await push(ref(db,`messages/${currentChannel}`),{...base,type:'image',imgData:f.data});}
      else{await push(ref(db,`messages/${currentChannel}`),{...base,type:'file',fileName:f.name,fileSize:f.size,fileType:f.type,fileData:f.data});}
    }catch(err){console.error('Dosya gönderilemedi:',err);window.showToast('❌ "'+f.name+'" gönderilemedi.', 'error');}
  }
  pendingFiles=[];refreshAttachBar();
};

document.getElementById('fileInput').onchange = async e => {
  if(!currentUser) return;
  const files=[...e.target.files];
  const MAX_SIZE=500*1024;
  const tooBig = files.filter(f => !f.type.startsWith('image/') && f.size > MAX_SIZE);
  if(tooBig.length > 0) { window.showToast(`❌ Çok büyük dosya (max 500KB):\n${tooBig.map(f=>f.name).join('\n')}`, 'error'); }
  const valid = files.filter(f => f.type.startsWith('image/') || f.size <= MAX_SIZE);
  if(!valid.length) { e.target.value=''; return; }
  window.showToast('Görseller sıkıştırılıyor...', 'info');
  const readers = valid.map(async file => {
    const isImage = file.type.startsWith('image/');
    const data = isImage ? await compressImage(file, 1000, 0.6) : await new Promise(res => {
      const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(file);
    });
    const estSize = isImage ? Math.round(data.length * 0.75) : file.size;
    return { name: file.name, size: estSize, type: file.type, data, isImage };
  });
  const results = await Promise.all(readers);
  const finalResults = results.filter(r => r.size <= MAX_SIZE*1.5);
  if(finalResults.length < results.length) window.showToast('Bazı resimler çok büyüktü.', 'error');
  pendingFiles.push(...finalResults);
  refreshAttachBar();
  e.target.value='';
};

// ─── GRADIENT BUILDER ───
function buildGradDots(cid, current, onSel) {
  const c=document.getElementById(cid);c.innerHTML='';
  GRAD_COLORS.forEach(col=>{
    const d=document.createElement('div');d.className='cdot'+(col===current?' selected':'');d.style.background=col;d.title=col;
    d.onclick=()=>{c.querySelectorAll('.cdot').forEach(x=>x.classList.remove('selected'));d.classList.add('selected');onSel(col);updateTitlePreview();};
    c.appendChild(d);
  });
}
function updateTitlePreview(){
  const box=document.getElementById('titlePreviewBox');const title=document.getElementById('editTitleInput').value||'Önizleme';
  box.textContent=title;box.style.background=`linear-gradient(90deg,${gradC1},${gradC2})`;
  box.style.webkitBackgroundClip='text';box.style.webkitTextFillColor='transparent';box.style.backgroundClip='text';
}
document.getElementById('editTitleInput').addEventListener('input',updateTitlePreview);

window.selectRole=(role,el)=>{document.querySelectorAll('.role-opt').forEach(x=>x.classList.remove('selected'));el.classList.add('selected');document.getElementById('ownerCodeWrap').classList.toggle('show',role==='owner');};
window.closeModal=id=>document.getElementById(id).classList.add('hidden');

function checkMobile(){
  // Sadece CSS media query ile hallediliyor, JS override etmesin
  // Ama toggle butonunu da garantiye alalım
  const btn=document.getElementById('sidebarToggle');
  if(btn){btn.style.removeProperty('display');}
}
window.addEventListener('resize',checkMobile);
// toggleSidebar ve click dışına tıklayınca kapat
window.toggleSidebar=()=>{
  const sb=document.querySelector('.sidebar');
  const ov=document.getElementById('sidebarOverlay');
  sb.classList.toggle('open');
  ov.classList.toggle('show');
};

['addChannelModal','addVcModal','profileModal','editProfileModal','boredModal','pollModal','ownerToolsModal','announceModal','confirmModal','slowModeModal','roleModal'].forEach(id=>{
  document.getElementById(id).addEventListener('click',e=>{ if(e.target.id===id)window.closeModal(id); });
});

// VC modal butonlarını bağla
bindVcModalButtons();

function renderPP(el,u){if(u.photoData){el.innerHTML=`<img src="${u.photoData}" alt="pp"/>`;}else{el.textContent=u.avatar||'🧑';}}
function gradTitle(text,c1,c2){const s=document.createElement('span');s.className='msg-title-tag';s.textContent=text;if(c1&&c2&&c1!==c2){s.style.background=`linear-gradient(90deg,${c1},${c2})`;s.style.webkitBackgroundClip='text';s.style.webkitTextFillColor='transparent';s.style.backgroundClip='text';}else{s.style.color=c1||'#a7a9be';}return s;}

// ─── JOIN ───
window.joinChat=async()=>{
  const name=document.getElementById('nameInput').value.trim();
  const bio=document.getElementById('bioInput').value.trim();
  const avatar=document.querySelector('.avatar-btn.selected')?.textContent||'🧑';
  const role=document.querySelector('.role-opt.selected')?.dataset.role||'member';
  if(!name){document.getElementById('nameInput').style.borderColor='#ff4444';return;}
  const botPatterns=[/^bot[_\-\d]/i,/^fake[_\-]/i,/^load[_\-]test/i,/^spam/i,/^test[_\-\d]/i,/^\d{4,}/];
  if(botPatterns.some(p=>p.test(name))){document.getElementById('nameInput').style.borderColor='#ff4444';window.showToast('❌ Bu isim kullanılamaz.', 'error');return;}
  if(role==='owner'){const codeOk=await checkOwnerCode(document.getElementById('ownerCodeInput').value);if(!codeOk){window.showToast('❌ Kurucu kodu yanlış!', 'error');return;}}
  currentUser={name,avatar,role,bio:bio||'',photoData:loginPhotoData||null,title:'',gradC1:GRAD_COLORS[0],gradC2:GRAD_COLORS[2]};
  const avatarBtns=[...document.querySelectorAll('.avatar-btn')];const avatarIdx=avatarBtns.findIndex(b=>b.classList.contains('selected'));
  localStorage.setItem('chatLogin',JSON.stringify({name,bio:bio||'',role,avatarIdx}));
  document.getElementById('headerName').textContent=name;renderPP(document.getElementById('headerPP'),currentUser);
  const rb=document.getElementById('headerRoleBadge');rb.className=`role-badge ${role}`;rb.textContent=role==='owner'?'👑 kurucu':'👤 üye';
  if(role==='owner')document.getElementById('ownerToolsBtn').classList.remove('hidden');
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('app').style.display='flex';

  // Önce varsayılan VC kanallarını oluştur (zaten varsa dokunma)
  try {
    const vcSnap=await get(ref(db,'vc_channels'));
    if(!vcSnap.val()){
      const defs=[['genel-ses','🔊 Genel Ses'],['muzik','🎵 Müzik'],['oyun','🎮 Oyun']];
      for(let i=0;i<defs.length;i++){
        await set(ref(db,`vc_channels/${defs[i][0]}`),{id:defs[i][0],name:defs[i][1],order:i,createdBy:'system'});
      }
    }
  } catch(e) { console.warn('VC kanal oluşturma hatası (rules?):', e.message); }

  setupOnlinePresence();
  setupInput();
  listenChannels();
  listenOnline();
  listenTyping();

  // VC kanallarını biraz gecikmeli dinle — DOM hazır olsun
  setTimeout(()=>listenVcChannels(), 200);

  // DM odalarını dinle
  setTimeout(()=>listenMyDmRooms(), 300);

  push(ref(db,'messages/genel'),{type:'system',text:`${avatar} ${name} sohbete katıldı!`,ts:Date.now()});
};

function setupOnlinePresence(){
  myOnlineRef=ref(db,`online/${currentUser.name}`);set(myOnlineRef,{...currentUser,ts:Date.now()});
  onDisconnect(myOnlineRef).remove();
  presenceInterval=setInterval(()=>{if(currentUser&&myOnlineRef)set(myOnlineRef,{...currentUser,ts:Date.now()});},10000);
  onValue(myOnlineRef,snap=>{
    const d=snap.val();if(!d||!currentUser)return;
    if(d.role&&d.role!==currentUser.role){
      currentUser.role=d.role;const rb=document.getElementById('headerRoleBadge');rb.className=`role-badge ${d.role}`;rb.textContent=d.role==='owner'?'👑 kurucu':'👤 üye';
      const ownerBtn=document.getElementById('ownerToolsBtn');if(d.role==='owner')ownerBtn.classList.remove('hidden');else ownerBtn.classList.add('hidden');
    }
  });
}

window.logout=()=>{
  if(vcState.currentChannel) leaveVoiceChannel(true);
  if(currentUser){push(ref(db,`messages/${currentChannel}`),{type:'system',text:`👋 ${currentUser.avatar} ${currentUser.name} ayrıldı.`,ts:Date.now()});if(myOnlineRef)remove(myOnlineRef);if(myTypingRef)remove(myTypingRef);if(presenceInterval)clearInterval(presenceInterval);[unsubMessages,unsubPinned,unsubSlowMode,unsubAnnounce,unsubTyping].forEach(u=>u&&u());}
  currentUser=null;document.getElementById('loginScreen').style.display='flex';document.getElementById('app').style.display='none';document.getElementById('nameInput').value='';
};

window.sendMessage=async()=>{
  const input=document.getElementById('msgInput');const text=input.value.trim();if(!text||!currentUser||text.length>2000)return;
  const safeName=currentUser.name||'';if(safeName.length<2||safeName.length>30){return;}
  const muteSnap=await get(ref(db,`muted/${currentUser.name}`));
  if(muteSnap.val()){input.placeholder='🔇 Susturuldunuz.';input.style.borderColor='#ef476f';setTimeout(()=>{input.placeholder='Mesaj yaz...';input.style.borderColor='';},2000);return;}
  const now2=Date.now();
  if(now2<rateLimitedUntil){const secs=Math.ceil((rateLimitedUntil-now2)/1000);input.placeholder=`🚫 Çok hızlı! ${secs}s bekle.`;input.style.borderColor='#ef476f';setTimeout(()=>{input.placeholder='Mesaj yaz...';input.style.borderColor='';},2000);return;}
  const cutoff=now2-RATE_LIMIT_WINDOW;while(MSG_TIMESTAMPS.length&&MSG_TIMESTAMPS[0]<cutoff)MSG_TIMESTAMPS.shift();
  if(MSG_TIMESTAMPS.length>=RATE_LIMIT_COUNT){
    rateLimitedUntil=now2+RATE_LIMIT_COOLDOWN;input.placeholder=`🤖 Spam! 8s bekle.`;input.style.borderColor='#ef476f';
    push(ref(db,`messages/${currentChannel}`),{type:'system',text:`⚠️ ${currentUser.name} spam korumasına takıldı.`,ts:Date.now()});
    setTimeout(()=>{input.placeholder='Mesaj yaz...';input.style.borderColor='';},RATE_LIMIT_COOLDOWN);return;
  }
  MSG_TIMESTAMPS.push(now2);
  if(slowMode&&slowModeSecs>0&&currentUser.role!=='owner'){const now=Date.now();if(now-lastSentTime<slowModeSecs*1000){return;}lastSentTime=now;startSlowCountdown();}
  input.value='';input.style.height='auto';
  if(myTypingRef)remove(myTypingRef);clearTimeout(typingTimer);
  try {
    await push(ref(db,`messages/${currentChannel}`),{type:'user',author:currentUser.name,avatar:currentUser.avatar,role:currentUser.role,title:currentUser.title,gradC1:currentUser.gradC1,gradC2:currentUser.gradC2,photoData:currentUser.photoData||null,text,ts:Date.now()});
  } catch(err) {
    if(err.message&&err.message.includes('PERMISSION_DENIED')){
      input.style.borderColor='#ef476f';
      input.placeholder='❌ Firebase izni yok! Console→Rules→ ".write":true yap';
      setTimeout(()=>{input.placeholder='Mesaj yaz...';input.style.borderColor='';},5000);
    }
  }
};

// ─── CHANNELS ───
function listenChannels(){
  onValue(ref(db,'channels'),snapshot=>{
    const data=snapshot.val();
    if(!data){[{id:'genel',name:'genel',desc:'Genel sohbet',order:0},{id:'sohbet',name:'sohbet',desc:'Günlük sohbet',order:1},{id:'eglence',name:'eglence',desc:'Eğlence',order:2},{id:'duyurular',name:'duyurular',desc:'Duyurular',order:3}].forEach(ch=>set(ref(db,`channels/${ch.id}`),ch));}
    else renderChannels(Object.values(data).sort((a,b)=>(a.order||0)-(b.order||0)));
    listenPinned();
  });
}
function renderChannels(channels){
  const list=document.getElementById('channelList');list.innerHTML='';
  channels.forEach(ch=>{
    const item=document.createElement('div');item.className='channel-item'+(ch.id===currentChannel?' active':'');
    item.innerHTML=`<span class="ch-hash">#</span><span>${ch.name}</span>`;
    if(currentUser?.role==='owner'&&ch.id!=='genel'){const del=document.createElement('span');del.className='ch-del';del.textContent='✕';del.onclick=e=>{e.stopPropagation();deleteChannel(ch.id,ch.name);};item.appendChild(del);}
    item.onclick=()=>switchChannel(ch.id,ch.name,ch.desc||'');
    list.appendChild(item);
  });
}
function switchChannel(id,name,desc){
  // DM modundan çık
  if(dmMode){if(unsubDmMessages){unsubDmMessages();unsubDmMessages=null;}dmMode=false;currentDmRoom=null;const hh=document.querySelector('.chat-header-hash,.chat-header-dm-icon');if(hh){hh.textContent='#';hh.className='chat-header-hash';}document.querySelectorAll('.dm-item').forEach(el=>el.classList.remove('active'));}
  currentChannel=id;document.getElementById('chatHeaderName').textContent=name;document.getElementById('chatHeaderDesc').textContent=desc;
  document.getElementById('activeChanBadge').textContent='#'+name;document.getElementById('messagesContainer').innerHTML='<div class="day-divider">Bugün</div>';
  if(currentUser?.role==='owner')document.getElementById('ownerToolsBtn').classList.remove('hidden');
  listenMessages();listenPinned();listenSlowMode();listenAnnounceOverlay();
  document.querySelectorAll('.channel-item').forEach(el=>el.classList.toggle('active',el.querySelector('span:nth-child(2)')?.textContent===name));
  // Mobilden sidebar'ı otomatik kapat
  if(window.innerWidth<=900){
    const sb=document.querySelector('.sidebar');const ov=document.getElementById('sidebarOverlay');
    if(sb&&sb.classList.contains('open')){sb.classList.remove('open');ov.classList.remove('show');}
  }
}

// ─── KÜFÜR BOT ─── (Kaldırıldı)


// ─── SİSTEM MESAJI OTO-GİZLE ───
// Hangi sistem mesajı key'lerinin zaten gösterildiğini takip et
const shownSysMsgKeys = new Set();

function autoFadeSysMsg(el, delayMs=5000){
  const bar=document.createElement('div');
  bar.style.cssText=`position:absolute;bottom:0;left:0;height:2px;background:var(--accent3);border-radius:2px;width:100%;transform-origin:left;transition:transform ${delayMs}ms linear;`;
  el.style.position='relative';
  el.appendChild(bar);
  requestAnimationFrame(()=>{ bar.style.transform='scaleX(0)'; });
  setTimeout(()=>{
    el.classList.add('fading');
    setTimeout(()=>{ if(el.parentNode) el.remove(); },650);
  }, delayMs);
}

// ─── MESSAGES ───
const MSG_LIMIT=80;let lastSeenMsgKey=null;let isFirstLoad=true;
let prevMsgCount=0;
function listenMessages(){
  if(unsubMessages)unsubMessages();lastSeenMsgKey=null;isFirstLoad=true;prevMsgCount=0;
  // Kanal değişince shown sys msg cache'i temizle
  shownSysMsgKeys.clear();
  const msgsQuery=query(ref(db,`messages/${currentChannel}`),orderByKey(),limitToLast(MSG_LIMIT));
  unsubMessages=onValue(msgsQuery,snapshot=>{
    const data=snapshot.val()||{};const entries=Object.entries(data).sort((a,b)=>a[1].ts-b[1].ts);
    const isNewMsg=!isFirstLoad&&entries.length>prevMsgCount;
    prevMsgCount=entries.length;
    renderMessages(entries,isNewMsg);
    if(!isFirstLoad&&currentUser?.role==='owner'){entries.forEach(([key,msg])=>{if(lastSeenMsgKey&&key>lastSeenMsgKey){/* botKufurKontrol(key,msg); */}});}
    if(entries.length>0){lastSeenMsgKey=entries[entries.length-1][0];}
    isFirstLoad=false;
  });
}

function renderMessages(entries, isNewMsg=false){
  const container=document.getElementById('messagesContainer');

  // Sadece user/image/file/poll/announce mesajlarını yeniden render et
  // Sistem mesajları ayrı yönetilir
  container.innerHTML='<div class="day-divider">Bugün</div>';
  let prevAuthor=null,currentGroup=null;
  entries.forEach(([key,msg])=>{
    if(localDeleted.has(key))return;
    if(msg.type==='system'){
      // Daha önce gösterilmişse DOM'a koyma (zaten kayboldu veya fade oluyor)
      if(shownSysMsgKeys.has(key)) return;
      shownSysMsgKeys.add(key);

      const div=document.createElement('div');div.className='sys-msg';
      const t=msg.text||'';
      let icon='💬';
      if(t.includes('katıldı'))icon='👋';
      else if(t.includes('ayrıldı')||t.includes('ayrıl'))icon='🚶';
      else if(t.includes('atıldı')||t.includes('atıl'))icon='🚫';
      else if(t.includes('sildi')||t.includes('silin'))icon='🗑️';
      else if(t.includes('sustur'))icon='🔇';
      else if(t.includes('kaldırıldı'))icon='🔊';
      else if(t.includes('spam'))icon='⚠️';
      else if(t.includes('ModBot'))icon='🤖';
      else if(t.includes('kanalı')||t.includes('📢'))icon='📢';
      else if(t.includes('ses kanalı')||t.includes('🔊'))icon='🔊';
      div.innerHTML=`<span>${icon}</span><span>${t}</span>`;
      container.appendChild(div);
      autoFadeSysMsg(div, 5000);
      prevAuthor=null;currentGroup=null;
    }
    else if(msg.type==='announce'){const div=document.createElement('div');div.className='announce-msg';div.textContent='📢 '+msg.text;container.appendChild(div);prevAuthor=null;currentGroup=null;}
    else if(msg.type==='poll'){renderPollMsg(container,key,msg);prevAuthor=null;currentGroup=null;}
    else if(msg.type==='file'){
      const isOwn=msg.author===currentUser?.name;
      if(msg.author!==prevAuthor){currentGroup=buildMsgGroup(isOwn,msg,container);prevAuthor=msg.author;}
      const wrap=document.createElement('div');wrap.className='msg-bw';
      const a=document.createElement('a');a.className='file-bubble'+(isOwn?' own':'');a.href=msg.fileData;a.download=msg.fileName;a.target='_blank';
      const icon=document.createElement('span');icon.className='file-icon';icon.textContent=getFileIcon(msg.fileType||'');
      const info=document.createElement('div');info.className='file-info';
      const nm=document.createElement('div');nm.className='file-name';nm.textContent=msg.fileName;
      const sz=document.createElement('div');sz.className='file-size';sz.textContent=formatBytes(msg.fileSize||0);
      const dl=document.createElement('div');dl.className='file-dl';dl.textContent='⬇️ İndir';
      info.appendChild(nm);info.appendChild(sz);info.appendChild(dl);a.appendChild(icon);a.appendChild(info);wrap.appendChild(a);
      appendMsgActions(wrap,key,msg,isOwn);currentGroup.appendChild(wrap);
      renderReactions(currentGroup,key,msg.reactions,isOwn);
    }else if(msg.type==='image'){
      const isOwn=msg.author===currentUser?.name;
      if(msg.author!==prevAuthor){currentGroup=buildMsgGroup(isOwn,msg,container);prevAuthor=msg.author;}
      const wrap=document.createElement('div');wrap.className='msg-bw';
      const img=document.createElement('img');img.className='msg-img'+(isOwn?' own':'');img.src=msg.imgData;img.alt='resim';img.onclick=()=>openImgViewer(msg.imgData);
      wrap.appendChild(img);appendMsgActions(wrap,key,msg,isOwn);currentGroup.appendChild(wrap);
      renderReactions(currentGroup,key,msg.reactions,isOwn);
    }else{
      const isOwn=msg.author===currentUser?.name;
      if(msg.author!==prevAuthor){currentGroup=buildMsgGroup(isOwn,msg,container);prevAuthor=msg.author;}
      const wrap=document.createElement('div');wrap.className='msg-bw';
      const bubble=document.createElement('div');bubble.className='msg-bubble'+(isOwn?' own':'');bubble.textContent=msg.text;
      if(msg.edited){const et=document.createElement('span');et.className='edited-tag';et.textContent='(düzenlendi)';bubble.appendChild(et);}
      wrap.appendChild(bubble);appendMsgActions(wrap,key,msg,isOwn);currentGroup.appendChild(wrap);
      renderReactions(currentGroup,key,msg.reactions,isOwn);
    }
  });
  const container2=document.getElementById('messagesContainer');
  const distFromBottom=container2.scrollHeight-container2.scrollTop-container2.clientHeight;
  if(distFromBottom<180){
    container2.scrollTop=container2.scrollHeight;
  } else if(isNewMsg){
    unreadCount++;
    document.getElementById('scrollToBottomBtn').classList.add('visible');
    renderUnreadBadge();
  }
}

function buildMsgGroup(isOwn,msg,container){
  const time=new Date(msg.ts).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
  const g=document.createElement('div');g.className='msg-group'+(isOwn?' own':'');
  const h=document.createElement('div');h.className='msg-group-header';
  const av=document.createElement('div');av.className='msg-avatar';
  if(msg.photoData){av.innerHTML=`<img src="${msg.photoData}" alt="pp"/>`;}else{av.textContent=msg.avatar||'🧑';}
  av.onclick=()=>showProfile(msg.author);
  const au=document.createElement('span');au.className='msg-author';au.style.color=isOwn?'var(--accent)':getColor(msg.author);au.textContent=msg.author+(msg.role==='owner'?' 👑':'');
  au.onclick=()=>showProfile(msg.author);
  if(msg.title)au.appendChild(gradTitle(msg.title,msg.gradC1,msg.gradC2));
  const ts=document.createElement('span');ts.className='msg-time';ts.textContent=time;
  h.appendChild(av);h.appendChild(au);h.appendChild(ts);g.appendChild(h);container.appendChild(g);return g;
}

function appendMsgActions(wrap,key,msg,isOwn){
  const isOwner=currentUser?.role==='owner';
  const actions=document.createElement('div');actions.className='msg-actions';

  // 😊 Reaksiyon butonu (herkes)
  if(currentUser){
    const reactBtn=document.createElement('span');reactBtn.className='msg-action-btn react-btn';reactBtn.textContent='😊';reactBtn.title='Reaksiyon';
    reactBtn.onclick=(e)=>{e.stopPropagation();toggleReactPicker(reactBtn,key,msg,wrap);};
    actions.appendChild(reactBtn);
  }

  // Pin (owner only)
  if(isOwner){
    const pinBtn=document.createElement('span');pinBtn.className='msg-action-btn pin-btn';pinBtn.textContent='📌';pinBtn.title='Sabitle';
    pinBtn.onclick=()=>pinMessage(key,msg.text||'[Resim]');
    actions.appendChild(pinBtn);
function appendMsgActions(wrap,key,msg,isOwn){
  const isOwner=currentUser?.role==='owner' && !dmMode;
  const actions=document.createElement('div');actions.className='msg-actions';

  // 😊 Reaksiyon butonu (herkes)
  if(currentUser){
    const reactBtn=document.createElement('span');reactBtn.className='msg-action-btn react-btn';reactBtn.textContent='😊';reactBtn.title='Reaksiyon';
    reactBtn.onclick=(e)=>{e.stopPropagation();toggleReactPicker(reactBtn,key,msg,wrap);};
    actions.appendChild(reactBtn);
  }

  // Pin (owner only, no DM)
  if(isOwner){
    const pinBtn=document.createElement('span');pinBtn.className='msg-action-btn pin-btn';pinBtn.textContent='📌';pinBtn.title='Sabitle';
    pinBtn.onclick=()=>pinMessage(key,msg.text||'[Resim]');
    actions.appendChild(pinBtn);
  }
  // Delete from everyone (owner or own msg)
  if(isOwn||isOwner){
    const delAll=document.createElement('span');delAll.className='msg-action-btn danger';delAll.textContent='🗑️';delAll.title='Herkesten sil';
    delAll.onclick=()=>{
      if(dmMode){
        remove(ref(db,`dm_messages/${currentDmRoom}/${key}`));
      } else {
        const dn=currentUser.name;const io=msg.author===currentUser.name;
        const nt=io?`🗑️ ${dn} kendi mesajını sildi.`:`🗑️ ${dn}, ${msg.author} adlı kişinin mesajını sildi.`;
        remove(ref(db,`messages/${currentChannel}/${key}`));
        push(ref(db,`messages/${currentChannel}`),{type:'system',text:nt,ts:Date.now()});
      }
    };
    actions.appendChild(delAll);
  }
  // Delete only for me (no DM)
  if(!dmMode && isOwn){
    const delMe=document.createElement('span');delMe.className='msg-action-btn';delMe.textContent='🙈';delMe.title='Sadece benden sil';
    delMe.onclick=()=>{localDeleted.add(key);const arr=[...localDeleted].slice(-500);localStorage.setItem('localDeleted',JSON.stringify(arr));localDeleted=new Set(arr);wrap.closest('.msg-group')?.remove()||wrap.remove();};
    actions.appendChild(delMe);
  }
  // Edit (own text messages only)
  if(isOwn&&msg.type==='user'){
    const editBtn=document.createElement('span');editBtn.className='msg-action-btn';editBtn.textContent='✏️';editBtn.title='Düzenle';
    editBtn.onclick=()=>startEditMsg(wrap,key,msg);
    actions.insertBefore(editBtn,actions.firstChild);
  }
  // Mobil touch desteği
  wrap.addEventListener('touchstart',()=>{
    document.querySelectorAll('.msg-actions').forEach(a=>{if(a!==actions)a.style.opacity='0';});
    actions.style.opacity=actions.style.opacity==='1'?'0':'1';
  },{passive:true});
  wrap.appendChild(actions);
}

// Reaksiyon picker aç/kapat
const QUICK_REACTS=['👍','❤️','😂','😮','😢','🔥','🎉','💯'];
function toggleReactPicker(btn,key,msg,wrap){
  // Aç ya da kapat
  const existing=wrap.querySelector('.react-picker');
  if(existing){existing.remove();return;}
  // Diğer açık pickerleri kapat
  document.querySelectorAll('.react-picker').forEach(p=>p.remove());
  const picker=document.createElement('div');picker.className='react-picker';
  QUICK_REACTS.forEach(emoji=>{
    const opt=document.createElement('span');opt.className='react-opt';opt.textContent=emoji;
    opt.onclick=(e)=>{e.stopPropagation();addReaction(key,emoji);picker.remove();};
    picker.appendChild(opt);
  });
  btn.parentElement.style.position='relative';
  btn.parentElement.appendChild(picker);
  // Dışarı tıklayınca kapat
  setTimeout(()=>document.addEventListener('click',function cl(){picker.remove();document.removeEventListener('click',cl);},{once:true}),10);
}

function addReaction(msgKey,emoji){
  if(!currentUser)return;
  const path = dmMode ? `dm_messages/${currentDmRoom}/${msgKey}/reactions/${emoji}/${currentUser.name}` : `messages/${currentChannel}/${msgKey}/reactions/${emoji}/${currentUser.name}`;
  const rRef=ref(db, path);
  get(rRef).then(snap=>{
    if(snap.val()){remove(rRef);}// toggle off
    else{set(rRef,true);}
  });
}

function renderReactions(container,key,reactions,isOwn){
  if(!reactions)return;
  const row=document.createElement('div');row.className='msg-reactions'+(isOwn?' own':'');
  Object.entries(reactions).forEach(([emoji,voters])=>{
    if(!voters)return;
    const count=Object.keys(voters).length;if(count===0)return;
    const mine=currentUser&&voters[currentUser.name];
    const chip=document.createElement('span');chip.className='reaction-chip'+(mine?' mine':'');
    chip.innerHTML=`${emoji}<span class="reaction-count">${count}</span>`;
    chip.title=Object.keys(voters).join(', ');
    chip.onclick=()=>addReaction(key,emoji);
    row.appendChild(chip);
  });
  if(row.children.length>0)container.appendChild(row);
}

function startEditMsg(wrap,key,msg){
  const bubble=wrap.querySelector('.msg-bubble');if(!bubble)return;
  const origText=msg.text;const textarea=document.createElement('textarea');textarea.className='editing-input';textarea.value=origText;textarea.style.marginLeft='39px';
  const actions=wrap.querySelector('.msg-actions');wrap.replaceChild(textarea,bubble);actions.style.display='none';textarea.focus();
  const btnRow=document.createElement('div');btnRow.style.cssText='margin-left:39px;display:flex;gap:4px;margin-top:3px;';
  const ok=document.createElement('button');ok.className='edit-confirm-btn';ok.textContent='✅ Kaydet';
  const cancel=document.createElement('button');cancel.className='edit-cancel-btn';cancel.textContent='İptal';
  ok.onclick=()=>{
    const newText=textarea.value.trim();if(!newText){btnRow.remove();wrap.replaceChild(bubble,textarea);actions.style.display='';return;}
    const updatedMsg={...msg, text:newText, ts:msg.ts, edited:true, editedBy:currentUser.name};
    const path = dmMode ? `dm_messages/${currentDmRoom}/${key}` : `messages/${currentChannel}/${key}`;
    set(ref(db, path), updatedMsg);
    btnRow.remove();actions.style.display='';
  };
  cancel.onclick=()=>{btnRow.remove();wrap.replaceChild(bubble,textarea);actions.style.display='';};
  btnRow.appendChild(ok);btnRow.appendChild(cancel);wrap.appendChild(btnRow);
  textarea.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ok.click();}if(e.key==='Escape')cancel.click();});
}

// ─── PINNED ───
function listenPinned(){
  if(unsubPinned)unsubPinned();
  unsubPinned=onValue(ref(db,`pinned/${currentChannel}`),snapshot=>{
    const data=snapshot.val();const bar=document.getElementById('pinnedBar');
    if(data&&data.text){bar.classList.remove('hidden');document.getElementById('pinnedText').textContent=data.text;}
    else{bar.classList.add('hidden');}
  });
}
function pinMessage(key,text){set(ref(db,`pinned/${currentChannel}`),{key,text,by:currentUser.name});}
window.clearPin=()=>{if(currentUser?.role==='owner')remove(ref(db,`pinned/${currentChannel}`));};

function openImgViewer(src){const ov=document.createElement('div');ov.className='img-viewer-overlay';ov.innerHTML=`<img src="${src}" alt="resim"/>`;ov.onclick=()=>ov.remove();document.body.appendChild(ov);}

// ─── POLLS ───
function renderPollMsg(container,key,msg){
  const isOwn=msg.author===currentUser?.name;const wrap=document.createElement('div');wrap.className='msg-group'+(isOwn?' own':'');
  const h=document.createElement('div');h.className='msg-group-header';const av=document.createElement('div');av.className='msg-avatar';
  if(msg.photoData){av.innerHTML=`<img src="${msg.photoData}" alt="pp"/>`;}else{av.textContent=msg.avatar||'🧑';}
  const au=document.createElement('span');au.className='msg-author';au.style.color=isOwn?'var(--accent)':getColor(msg.author);au.textContent=msg.author;
  const ts=document.createElement('span');ts.className='msg-time';ts.textContent=new Date(msg.ts).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
  h.appendChild(av);h.appendChild(au);h.appendChild(ts);wrap.appendChild(h);
  const bub=document.createElement('div');bub.className='poll-bubble'+(isOwn?' own':'');
  const q=document.createElement('div');q.className='poll-question';q.textContent='📊 '+msg.question;bub.appendChild(q);
  const votes=msg.votes||{};const myVote=votes[currentUser?.name];const total=Object.keys(votes).length;
  msg.options.forEach((opt,i)=>{
    const cnt=Object.values(votes).filter(v=>v===i).length;const pct=total>0?Math.round((cnt/total)*100):0;
    const row=document.createElement('div');row.className='poll-option';const bw=document.createElement('div');bw.className='poll-bar-wrap';
    const bar=document.createElement('div');bar.className='poll-bar';bar.style.width=pct+'%';const lbl=document.createElement('div');lbl.className='poll-bar-label';lbl.textContent=opt;
    bw.appendChild(bar);bw.appendChild(lbl);const vb=document.createElement('button');vb.className='poll-vote-btn'+(myVote===i?' voted':'');
    vb.textContent=myVote!==undefined?pct+'%':'Oy ver';vb.onclick=()=>{if(!currentUser)return;set(ref(db,`messages/${currentChannel}/${key}/votes/${currentUser.name}`),i);};
    row.appendChild(bw);row.appendChild(vb);bub.appendChild(row);
  });
  const tot=document.createElement('div');tot.className='poll-total';tot.textContent=total+' oy';bub.appendChild(tot);wrap.appendChild(bub);container.appendChild(wrap);
}
window.openPollModal=()=>{if(!currentUser)return;document.getElementById('pollQuestion').value='';const opts=document.getElementById('pollOptions');opts.innerHTML='';addPollOption();addPollOption();document.getElementById('pollModal').classList.remove('hidden');};
window.addPollOption=()=>{const opts=document.getElementById('pollOptions');if(opts.children.length>=6)return;const row=document.createElement('div');row.className='poll-opt-row';const inp=document.createElement('input');inp.className='poll-opt-input';inp.placeholder=`Seçenek ${opts.children.length+1}`;const del=document.createElement('button');del.className='poll-opt-del';del.textContent='✕';del.onclick=()=>{if(opts.children.length>2)row.remove();};row.appendChild(inp);row.appendChild(del);opts.appendChild(row);};
window.sendPoll=()=>{const q=document.getElementById('pollQuestion').value.trim();const opts=[...document.getElementById('pollOptions').querySelectorAll('.poll-opt-input')].map(i=>i.value.trim()).filter(Boolean);if(!q||opts.length<2){alert('Soru ve en az 2 seçenek gir!');return;}push(ref(db,`messages/${currentChannel}`),{type:'poll',author:currentUser.name,avatar:currentUser.avatar,photoData:currentUser.photoData||null,question:q,options:opts,votes:{},ts:Date.now()});closeModal('pollModal');};

// ─── OWNER TOOLS ───
window.openOwnerTools=()=>{document.getElementById('ownerToolsChan').textContent=currentChannel;document.getElementById('ownerToolsModal').classList.remove('hidden');};
window.openAnnounce=()=>{closeModal('ownerToolsModal');document.getElementById('announceText').value='';document.getElementById('announceModal').classList.remove('hidden');};
window.sendAnnounce=()=>{const t=document.getElementById('announceText').value.trim();if(!t)return;push(ref(db,`messages/${currentChannel}`),{type:'announce',text:t,author:currentUser.name,ts:Date.now()});set(ref(db,`announce_overlay/${currentChannel}`),{text:t,by:currentUser.name,ts:Date.now()});closeModal('announceModal');};

function listenAnnounceOverlay(){
  if(unsubAnnounce)unsubAnnounce();
  unsubAnnounce=onValue(ref(db,`announce_overlay/${currentChannel}`),snapshot=>{
    const data=snapshot.val();if(!data)return;if(Date.now()-data.ts>20000)return;
    showAnnounceOverlay(data.text,data.by);if(currentUser?.role==='owner')setTimeout(()=>remove(ref(db,`announce_overlay/${currentChannel}`)),20000);
  });
}
function showAnnounceOverlay(text,by){
  const existing=document.getElementById('announceOverlayEl');if(existing)existing.remove();
  const ov=document.createElement('div');ov.className='announce-overlay';ov.id='announceOverlayEl';
  const colors=['#ff6b35','#ffd700','#3ecfcf','#7b5ea7','#ef476f','#84dcc6'];
  const particles=Array.from({length:14},(_,i)=>{const p=document.createElement('div');p.className='particle';p.style.cssText=`left:${5+i*7}%;top:${60+Math.random()*30}%;background:${colors[i%colors.length]};animation-delay:${Math.random()*1.5}s;animation-duration:${1.5+Math.random()}s;`;return p;});
  ov.innerHTML=`<div class="announce-card" style="position:relative;overflow:hidden"><div class="announce-particles">${particles.map(p=>p.outerHTML).join('')}</div><span class="announce-crown">📢</span><div class="announce-from">👑 ${by} duyuru yapıyor</div><div class="announce-text" id="announceTextEl"></div><button class="announce-dismiss" onclick="document.getElementById('announceOverlayEl').remove()">Tamam!</button></div>`;
  document.body.appendChild(ov);const atEl=document.getElementById('announceTextEl');if(atEl)atEl.textContent=text;
  setTimeout(()=>{const el=document.getElementById('announceOverlayEl');if(el){el.style.animation='aovIn 0.3s ease reverse';setTimeout(()=>{const el2=document.getElementById('announceOverlayEl');if(el2)el2.remove();},300);}},15000);
}

let slowModeSecs=0,slowModeTimer=null,lastSentTime=0,slowCountInterval=null;
window.openSlowModeSettings=()=>{closeModal('ownerToolsModal');document.getElementById('slowModeModal').classList.remove('hidden');};
window.enableSlowMode=()=>{const secs=parseInt(document.getElementById('slowModeSeconds').value);if(!secs||secs<1){alert('Geçerli bir saniye gir!');return;}slowModeSecs=secs;slowMode=true;set(ref(db,`slowmode/${currentChannel}`),{secs,by:currentUser.name});document.getElementById('slowModeBtn').classList.add('active');document.getElementById('slowModeBtn').textContent='🐢 Yavaş Mod: '+secs+'s';closeModal('slowModeModal');};
window.disableSlowMode=()=>{slowMode=false;slowModeSecs=0;remove(ref(db,`slowmode/${currentChannel}`));document.getElementById('slowModeBtn').classList.remove('active');document.getElementById('slowModeBtn').textContent='🐢 Yavaş Mod';document.getElementById('slowmodeBadge').classList.remove('visible');document.getElementById('msgInput').parentElement.classList.remove('slowmode-input-block');clearInterval(slowCountInterval);closeModal('slowModeModal');};

function listenSlowMode(){
  if(unsubSlowMode)unsubSlowMode();
  unsubSlowMode=onValue(ref(db,`slowmode/${currentChannel}`),snapshot=>{
    const data=snapshot.val();
    if(data&&data.secs){slowMode=true;slowModeSecs=data.secs;document.getElementById('slowmodeBadge').classList.add('visible');if(currentUser?.role!=='owner')showSlowmodeIdle();if(currentUser?.role==='owner'){document.getElementById('slowModeBtn').classList.add('active');document.getElementById('slowModeBtn').textContent='🐢 Yavaş Mod: '+data.secs+'s';}}
    else{slowMode=false;slowModeSecs=0;document.getElementById('slowmodeBadge').classList.remove('visible');document.getElementById('slowmodeInline').classList.remove('active','blocking');document.getElementById('msgInput').parentElement.classList.remove('slowmode-input-block');clearInterval(slowCountInterval);}
  });
}
function startSlowCountdown(){clearInterval(slowCountInterval);const inline=document.getElementById('slowmodeInline');const num=document.getElementById('slowmodeInlineNum');const inputBox=document.getElementById('msgInput').parentElement;inline.classList.add('active','blocking');inputBox.classList.add('slowmode-input-block');let remaining=slowModeSecs;num.textContent=remaining;slowCountInterval=setInterval(()=>{remaining--;num.textContent=remaining;if(remaining<=0){clearInterval(slowCountInterval);inline.classList.remove('blocking');if(slowMode)showSlowmodeIdle();else inline.classList.remove('active');inputBox.classList.remove('slowmode-input-block');}},1000);}
function showSlowmodeIdle(){const inline=document.getElementById('slowmodeInline');const num=document.getElementById('slowmodeInlineNum');inline.classList.add('active');inline.classList.remove('blocking');num.textContent=slowModeSecs;}

function showConfirm(title,desc,onOk){document.getElementById('confirmTitle').textContent=title;document.getElementById('confirmDesc').textContent=desc;const btn=document.getElementById('confirmOkBtn');btn.onclick=()=>{closeModal('confirmModal');onOk();};document.getElementById('confirmModal').classList.remove('hidden');}

window.deleteUserMessages=()=>{closeModal('ownerToolsModal');const target=prompt('Mesajları silinecek kullanıcı adı:');if(!target||!target.trim())return;const targetName=target.trim();showConfirm(`"${targetName}" adlı kişinin mesajları silinsin?`,`#${currentChannel} kanalındaki tüm mesajları kaldırılacak.`,async()=>{const snap=await get(ref(db,`messages/${currentChannel}`));const data=snap.val()||{};const delKeys=Object.entries(data).filter(([k,m])=>m.author===targetName).map(([k])=>k);if(delKeys.length===0){alert(`"${targetName}" adında mesaj bulunamadı.`);return;}await Promise.all(delKeys.map(k=>remove(ref(db,`messages/${currentChannel}/${k}`))));push(ref(db,`messages/${currentChannel}`),{type:'system',text:`🧹 ${currentUser.name} tarafından ${targetName} adlı kişinin ${delKeys.length} mesajı silindi.`,ts:Date.now()});});};
window.clearAllChannels=async()=>{closeModal('ownerToolsModal');showConfirm('TÜM KANALLAR temizlensin mi?','Tüm kanallardaki tüm mesajlar silinecek.',async()=>{if(unsubMessages){unsubMessages();unsubMessages=null;}document.getElementById('messagesContainer').innerHTML='<div class="day-divider">Bugün</div>';const snap=await get(ref(db,'channels'));const channels=Object.keys(snap.val()||{});for(const ch of channels){await remove(ref(db,`messages/${ch}`));}await push(ref(db,`messages/${currentChannel}`),{type:'system',text:`🗑️ ${currentUser.name} tüm kanalları temizledi.`,ts:Date.now()});listenMessages();});};
window.kickAllBots=async()=>{if(currentUser?.role!=='owner')return;const snap=await get(ref(db,'online'));const users=snap.val()||{};const botPatterns=[/^bot[_\-\d]/i,/^fake[_\-]/i,/^load[_\-]test/i,/^spam/i,/^test[_\-\d]/i];let kicked=0;for(const[key,u]of Object.entries(users)){if(botPatterns.some(p=>p.test(u.name||''))){await remove(ref(db,`online/${key}`));kicked++;}}push(ref(db,`messages/${currentChannel}`),{type:'system',text:`🤖 ${kicked} bot/sahte kullanıcı atıldı.`,ts:Date.now()});closeModal('ownerToolsModal');};
window.clearAllMessages=()=>{closeModal('ownerToolsModal');showConfirm('Tüm mesajları sil?','#'+currentChannel+' kanalındaki tüm mesajlar silinecek.',async()=>{if(unsubMessages){unsubMessages();unsubMessages=null;}document.getElementById('messagesContainer').innerHTML='<div class="day-divider">Bugün</div>';await remove(ref(db,`messages/${currentChannel}`));await push(ref(db,`messages/${currentChannel}`),{type:'system',text:`🗑️ ${currentUser.name} tüm mesajları sildi.`,ts:Date.now()});listenMessages();});};

// ─── ONLINE ───
function listenOnline(){
  onValue(ref(db,'online'),snapshot=>{
    const data=snapshot.val()||{};const users=Object.values(data);
    document.getElementById('onlineCountDisplay').textContent=`${users.length} çevrimiçi`;
    const list=document.getElementById('membersList');list.innerHTML='';
    users.sort((a,b)=>(a.role==='owner'?0:1)-(b.role==='owner'?0:1));
    users.forEach(u=>{
      const item=document.createElement('div');item.className='member-item';const isMe=u.name===currentUser?.name;const canKick=currentUser?.role==='owner'&&!isMe;
      const avW=document.createElement('div');avW.className='member-av-wrap';const av=document.createElement('div');av.className='member-av';
      if(u.photoData){av.innerHTML=`<img src="${u.photoData}" alt="pp"/>`;}else{av.textContent=u.avatar||'🧑';}
      const dot=document.createElement('div');dot.className='m-online-dot';avW.appendChild(av);avW.appendChild(dot);
      const info=document.createElement('div');info.className='member-info';const nm=document.createElement('div');nm.className='member-name';nm.textContent=u.name+(isMe?' (sen)':'');
      const tl=document.createElement('div');tl.className='member-title-text';
      if(u.title){tl.textContent=u.title;tl.style.background=`linear-gradient(90deg,${u.gradC1||'#ff6b35'},${u.gradC2||'#3ecfcf'})`;tl.style.webkitBackgroundClip='text';tl.style.webkitTextFillColor='transparent';tl.style.backgroundClip='text';}
      else{tl.textContent=u.role==='owner'?'👑 Kurucu':'👤 Üye';tl.style.color='var(--muted)';}
      info.appendChild(nm);info.appendChild(tl);item.appendChild(avW);item.appendChild(info);
      if(canKick){const kb=document.createElement('span');kb.className='kick-btn';kb.textContent='✕';kb.title='At';kb.onclick=e=>{e.stopPropagation();kickUser(u.name);};item.appendChild(kb);const mb=document.createElement('span');mb.className='kick-btn';mb.style.color='#ffd700';mb.title='Sustur/Aç';mb.textContent='🔇';mb.onclick=e=>{e.stopPropagation();toggleMute(u.name,mb);};get(ref(db,`muted/${u.name}`)).then(s=>{if(s.val()){mb.style.color='#ef476f';mb.textContent='🔊';}});item.appendChild(mb);}
      item.onclick=e=>{if(!e.target.classList.contains('kick-btn'))showProfile(u.name);};list.appendChild(item);
    });
  });
}
window.toggleMute=async(name,btn)=>{if(currentUser?.role!=='owner')return;const snap=await get(ref(db,`muted/${name}`));if(snap.val()){remove(ref(db,`muted/${name}`));push(ref(db,`messages/${currentChannel}`),{type:'system',text:`🔊 ${name} susturması kaldırıldı.`,ts:Date.now()});}else{set(ref(db,`muted/${name}`),{by:currentUser.name,ts:Date.now()});push(ref(db,`messages/${currentChannel}`),{type:'system',text:`🔇 ${name} susturuldu.`,ts:Date.now()});}};

// ─── ROLE ASSIGN ───
let roleModalTarget=null,roleModalSelected='member';
window.openRoleModal=(name,currentRole)=>{roleModalTarget=name;roleModalSelected=currentRole;document.getElementById('roleModalDesc').textContent=name+' adlı kullanıcının rolü: '+(currentRole==='owner'?'👑 Kurucu':'👤 Üye');document.getElementById('roleOptMember').classList.toggle('selected',currentRole==='member');document.getElementById('roleOptOwner').classList.toggle('selected',currentRole==='owner');document.getElementById('roleOwnerCodeWrap').style.display='none';document.getElementById('roleOwnerCode').value='';document.getElementById('roleModal').classList.remove('hidden');};
window.selectRoleModal=(role)=>{roleModalSelected=role;document.getElementById('roleOptMember').classList.toggle('selected',role==='member');document.getElementById('roleOptOwner').classList.toggle('selected',role==='owner');document.getElementById('roleOwnerCodeWrap').style.display=role==='owner'?'block':'none';};
window.confirmRoleChange=async()=>{if(!roleModalTarget)return;if(roleModalSelected==='owner'){const ok=await checkOwnerCode(document.getElementById('roleOwnerCode').value);if(!ok){alert('❌ Kurucu kodu yanlış!');return;}}const snap=await get(ref(db,`online/${roleModalTarget}`));const u=snap.val();if(!u)return;set(ref(db,`online/${roleModalTarget}`),{...u,role:roleModalSelected});push(ref(db,`messages/${currentChannel}`),{type:'system',text:`🎭 ${roleModalTarget} rolü ${roleModalSelected==='owner'?'👑 Kurucu':'👤 Üye'} olarak değiştirildi.`,ts:Date.now()});if(roleModalTarget===currentUser.name){currentUser.role=roleModalSelected;if(myOnlineRef)set(myOnlineRef,{...currentUser,ts:Date.now()});const rb=document.getElementById('headerRoleBadge');rb.className=`role-badge ${roleModalSelected}`;rb.textContent=roleModalSelected==='owner'?'👑 kurucu':'👤 üye';if(roleModalSelected==='owner')document.getElementById('ownerToolsBtn').classList.remove('hidden');else document.getElementById('ownerToolsBtn').classList.add('hidden');}closeModal('roleModal');};
window.kickUser=name=>{if(currentUser?.role!=='owner')return;remove(ref(db,`online/${name}`));push(ref(db,`messages/${currentChannel}`),{type:'system',text:`🚫 ${name} sohbetten atıldı.`,ts:Date.now()});};

// ─── TYPING ───
function listenTyping(){
  if(unsubTyping)unsubTyping();
  unsubTyping=onValue(ref(db,`typing/${currentChannel}`),snapshot=>{
    if(!currentUser)return;const data=snapshot.val()||{};const now=Date.now();
    const others=Object.entries(data).filter(([n,ts])=>n!==currentUser.name&&now-ts<4000).map(([n])=>n);
    const ind=document.getElementById('typingIndicator');const txt=document.getElementById('typingText');
    if(others.length>0){ind.classList.remove('hidden');txt.textContent=others.length===1?`${others[0]} yazıyor...`:`${others.join(', ')} yazıyor...`;}
    else ind.classList.add('hidden');
  });
}

// ─── PROFILE ───
window.showProfile=async name=>{
  const snap=await get(ref(db,`online/${name}`));const u=snap.val();if(!u)return;
  const ppEl=document.getElementById('profileModalPP');if(u.photoData){ppEl.innerHTML=`<img src="${u.photoData}" alt="pp"/>`;}else{ppEl.textContent=u.avatar||'🧑';}
  document.getElementById('profileModalName').textContent=u.name;
  const td=document.getElementById('profileModalTitle');
  if(u.title){td.textContent=u.title;td.style.background=`linear-gradient(90deg,${u.gradC1||'#ff6b35'},${u.gradC2||'#3ecfcf'})`;td.style.webkitBackgroundClip='text';td.style.webkitTextFillColor='transparent';td.style.backgroundClip='text';}
  else{td.textContent=u.role==='owner'?'👑 Kurucu':'👤 Üye';td.style.background='none';td.style.webkitTextFillColor='';td.style.color='var(--muted)';}
  document.getElementById('profileModalBio').textContent=u.bio||'Bio yok.';
  const btns=document.getElementById('profileModalBtns');btns.innerHTML='';
  const cb=document.createElement('button');cb.className='modal-btn secondary';cb.textContent='Kapat';cb.onclick=()=>closeModal('profileModal');btns.appendChild(cb);
  if(name===currentUser?.name){const eb=document.createElement('button');eb.className='modal-btn primary';eb.textContent='✏️ Düzenle';eb.onclick=()=>{closeModal('profileModal');openEditProfile();};btns.appendChild(eb);}
  if(currentUser?.role==='owner'||name===currentUser?.name){const rb=document.createElement('button');rb.className='modal-btn secondary';rb.textContent='🎭 Rol';rb.onclick=()=>{closeModal('profileModal');openRoleModal(name,u.role||'member');};btns.appendChild(rb);}
  document.getElementById('profileModal').classList.remove('hidden');
};
window.openMyProfile=()=>{if(currentUser)showProfile(currentUser.name);};

function openEditProfile(){
  document.getElementById('editTitleInput').value=currentUser.title||'';document.getElementById('editBioInput').value=currentUser.bio||'';
  gradC1=currentUser.gradC1||GRAD_COLORS[0];gradC2=currentUser.gradC2||GRAD_COLORS[2];
  const prev=document.getElementById('editPPPreview');
  if(currentUser.photoData){prev.innerHTML=`<img src="${currentUser.photoData}" alt="pp"/>`;}else{prev.textContent=currentUser.avatar||'🧑';}
  editPhotoData=currentUser.photoData||null;buildGradDots('gradColor1Dots',gradC1,c=>{gradC1=c;});buildGradDots('gradColor2Dots',gradC2,c=>{gradC2=c;});updateTitlePreview();
  document.getElementById('editPhotoInput').onchange=e=>{const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=ev=>{editPhotoData=ev.target.result;const p=document.getElementById('editPPPreview');p.innerHTML=`<img src="${editPhotoData}" alt="pp"/>`;};r.readAsDataURL(file);};
  document.getElementById('editProfileModal').classList.remove('hidden');
}
window.saveProfile=()=>{currentUser.title=document.getElementById('editTitleInput').value.trim();currentUser.bio=document.getElementById('editBioInput').value.trim();currentUser.gradC1=gradC1;currentUser.gradC2=gradC2;if(editPhotoData)currentUser.photoData=editPhotoData;if(myOnlineRef)set(myOnlineRef,{...currentUser,ts:Date.now()});renderPP(document.getElementById('headerPP'),currentUser);closeModal('editProfileModal');};

// ─── CHANNELS ───
window.openAddChannel=()=>{if(!currentUser)return;document.getElementById('addChannelModal').classList.remove('hidden');document.getElementById('newChannelName').focus();};
window.createChannel=()=>{const name=document.getElementById('newChannelName').value.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9\-]/g,'');const desc=document.getElementById('newChannelDesc').value.trim();if(!name)return;set(ref(db,`channels/${name}`),{id:name,name,desc,order:Date.now(),createdBy:currentUser.name});push(ref(db,`messages/${name}`),{type:'system',text:`📢 #${name} kanalı ${currentUser.name} tarafından oluşturuldu!`,ts:Date.now()});document.getElementById('newChannelName').value='';document.getElementById('newChannelDesc').value='';closeModal('addChannelModal');switchChannel(name,name,desc);};
window.deleteChannel=(id,name)=>{if(currentUser?.role!=='owner')return;showConfirm(`#${name} silinsin mi?`,`Bu kanal ve içindeki tüm mesajlar kalıcı olarak silinecek.`,()=>{remove(ref(db,`channels/${id}`));remove(ref(db,`messages/${id}`));if(currentChannel===id)switchChannel('genel','genel','Genel sohbet kanalı');});};

window.openBored=()=>document.getElementById('boredModal').classList.remove('hidden');
window.randomFun=()=>window.open(FUN_LINKS[Math.floor(Math.random()*FUN_LINKS.length)],'_blank');

function getColor(n){const c=['#7b5ea7','#3ecfcf','#f7c59f','#e8a0bf','#84dcc6','#a0c4ff','#ffd166','#ef476f'];let h=0;for(let x of n)h=(h*31+x.charCodeAt(0))%c.length;return c[h];}

function setupInput(){
  const input=document.getElementById('msgInput');
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});
  input.addEventListener('input',()=>{
    input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px';
    if(currentUser){myTypingRef=ref(db,`typing/${currentChannel}/${currentUser.name}`);set(myTypingRef,Date.now());clearTimeout(typingTimer);typingTimer=setTimeout(()=>{if(myTypingRef)remove(myTypingRef);},3000);}
  });
  // Mobil klavye açıldığında input görünür kalsın
  input.addEventListener('focus',()=>{
    if(window.innerWidth<=900){
      setTimeout(()=>{
        input.scrollIntoView({behavior:'smooth',block:'end'});
        const container=document.getElementById('messagesContainer');
        if(container) container.scrollTop=container.scrollHeight;
      },350);
    }
  });
}

// ─── SCROLL TO BOTTOM ───
let unreadCount=0;
window.scrollToBottom=()=>{
  const c=document.getElementById('messagesContainer');
  c.scrollTo({top:c.scrollHeight,behavior:'smooth'});
  unreadCount=0;
  document.getElementById('scrollToBottomBtn').classList.remove('visible');
};

function initScrollWatcher(){
  const c=document.getElementById('messagesContainer');
  const btn=document.getElementById('scrollToBottomBtn');
  c.addEventListener('scroll',()=>{
    const distFromBottom=c.scrollHeight-c.scrollTop-c.clientHeight;
    if(distFromBottom>120){btn.classList.add('visible');}
    else{btn.classList.remove('visible');unreadCount=0;renderUnreadBadge();}
  });
}
function renderUnreadBadge(){
  const btn=document.getElementById('scrollToBottomBtn');
  let dot=btn.querySelector('.unread-dot');
  if(unreadCount>0){
    if(!dot){dot=document.createElement('span');dot.className='unread-dot';btn.appendChild(dot);}
    dot.textContent=unreadCount>9?'9+':unreadCount;
  } else { if(dot)dot.remove(); }
}

listenChannels();
switchChannel('genel','genel','Genel sohbet kanalı');
initScrollWatcher();

// Mobil: visualViewport resize (klavye açıldığında layout düzelt)
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',()=>{
    const app=document.getElementById('app');
    if(app && window.innerWidth<=900){
      app.style.height=window.visualViewport.height+'px';
    }
  });
  window.visualViewport.addEventListener('scroll',()=>{
    const app=document.getElementById('app');
    if(app && window.innerWidth<=900){
      app.style.height=window.visualViewport.height+'px';
    }
  });
}

window.addEventListener('beforeunload',()=>{
  if(myOnlineRef)remove(myOnlineRef);
  if(myTypingRef)remove(myTypingRef);
  if(vcState.currentChannel)leaveVoiceChannel(true);
});

// ═══════════════════════════════════════════
//  DM (ÖZEL MESAJ) SİSTEMİ
// ═══════════════════════════════════════════

// Deterministik oda ID: iki kullanıcı adını sırala ve birleştir
function getDmRoomId(userA, userB) {
  const sorted = [userA.toLowerCase(), userB.toLowerCase()].sort();
  return sorted[0] + '__' + sorted[1];
}

// Karşı tarafın adını room verisinden çıkar
function getDmPartnerName(roomData) {
  if (!roomData?.participantList || !currentUser) return '?';
  return roomData.participantList.find(n => n !== currentUser.name) || '?';
}

// ── Yeni DM modalı aç ──
window.openNewDmModal = () => {
  if (!currentUser) { window.showToast('Önce giriş yapmalısın!', 'error'); return; }
  const modal = document.getElementById('dmModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('dmSearchInput').value = '';
  renderDmUserList();
  setTimeout(() => document.getElementById('dmSearchInput')?.focus(), 150);
};

// DM modalını da kapatılabilir yap
document.getElementById('dmModal')?.addEventListener('click', e => {
  if (e.target.id === 'dmModal') closeModal('dmModal');
});

// Kullanıcı listesini çiz (çevrimiçi listesinden)
function renderDmUserList(filterText) {
  const list = document.getElementById('dmUserList');
  if (!list) return;
  list.innerHTML = '';
  const filter = (filterText || '').toLowerCase();

  Object.entries(onlineUsersCache).forEach(([name, data]) => {
    if (name === currentUser?.name) return;
    if (filter && !name.toLowerCase().includes(filter)) return;

    const item = document.createElement('div');
    item.className = 'dm-user-pick';
    item.onclick = () => { closeModal('dmModal'); openOrCreateDm(name, data); };

    const av = document.createElement('div');
    av.className = 'dm-user-pick-av';
    if (data.photoData) { av.innerHTML = `<img src="${data.photoData}" alt="pp"/>`; }
    else { av.textContent = data.avatar || name.charAt(0).toUpperCase(); }

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';
    const nameEl = document.createElement('div');
    nameEl.className = 'dm-user-pick-name';
    nameEl.textContent = name;
    const status = document.createElement('div');
    status.className = 'dm-user-pick-status';
    status.textContent = '🟢 Çevrimiçi';
    info.appendChild(nameEl);
    info.appendChild(status);

    item.appendChild(av);
    item.appendChild(info);
    list.appendChild(item);
  });

  if (list.children.length === 0) {
    list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:0.8rem;">Kullanıcı bulunamadı.</div>';
  }
}

window.filterDmUsers = () => {
  const val = document.getElementById('dmSearchInput')?.value || '';
  renderDmUserList(val);
};

// ── DM aç veya oluştur ──
async function openOrCreateDm(targetName, targetData) {
  if (!currentUser) return;
  const roomId = getDmRoomId(currentUser.name, targetName);

  // Oda zaten var mı kontrol et
  const snap = await get(ref(db, `dm_rooms/${roomId}`));
  if (!snap.val()) {
    // Yeni oda oluştur
    await set(ref(db, `dm_rooms/${roomId}`), {
      participants: { [currentUser.name]: true, [targetName]: true },
      participantList: [currentUser.name, targetName],
      lastMessage: '',
      lastMessageBy: '',
      lastMessageTs: Date.now(),
      createdAt: Date.now()
    });
  }

  switchToDm(roomId, targetName, targetData);
}

// ── DM moduna geç ──
function switchToDm(roomId, partnerName, partnerData) {
  // Önceki dinleyicileri kapat
  if (unsubDmMessages) { unsubDmMessages(); unsubDmMessages = null; }

  dmMode = true;
  currentDmRoom = roomId;

  // Chat header'ı DM moduna geçir
  const hashEl = document.getElementById('chatHeaderHash') || document.querySelector('.chat-header-hash');
  const nameEl = document.getElementById('chatHeaderName');
  const descEl = document.getElementById('chatHeaderDesc');
  if (hashEl) hashEl.textContent = '@';
  if (hashEl) hashEl.className = 'chat-header-dm-icon';
  if (nameEl) nameEl.textContent = partnerName || '?';
  if (descEl) descEl.textContent = 'Özel mesaj';

  // Owner tools ve slowmode gizle, dmCallBtn göster
  document.getElementById('ownerToolsBtn')?.classList.add('hidden');
  document.getElementById('slowmodeBadge')?.classList.remove('visible');
  document.getElementById('pinnedBar')?.classList.add('hidden');
  document.getElementById('dmCallBtn')?.classList.remove('hidden');

  // Kanal badge güncelle
  const badge = document.getElementById('activeChanBadge');
  if (badge) badge.textContent = '@' + (partnerName || '?');

  // Sidebar DM active state
  document.querySelectorAll('.dm-item').forEach(el => el.classList.toggle('active', el.dataset.roomId === roomId));
  document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));

  // Okunmamış sıfırla
  markDmAsRead(roomId);

  // Mesaj container temizle ve dinle
  document.getElementById('messagesContainer').innerHTML = '<div class="day-divider">Özel Mesajlar</div>';
  listenDmMessages(roomId);

  // Mobilden sidebar kapat
  if (window.innerWidth <= 900) {
    const sb = document.querySelector('.sidebar');
    const ov = document.getElementById('sidebarOverlay');
    if (sb?.classList.contains('open')) { sb.classList.remove('open'); ov?.classList.remove('show'); }
  }
}

// ── Kanal moduna geri dön ──
window.switchToChannelMode = (channelId, channelName, channelDesc) => {
  if (unsubDmMessages) { unsubDmMessages(); unsubDmMessages = null; }
  dmMode = false;
  currentDmRoom = null;

  // Header'ı geri çevir
  const hashEl = document.getElementById('chatHeaderHash') || document.querySelector('.chat-header-hash');
  if (hashEl) { hashEl.textContent = '#'; hashEl.className = 'chat-header-hash'; }
  document.getElementById('dmCallBtn')?.classList.add('hidden');

  // Sidebar active states
  document.querySelectorAll('.dm-item').forEach(el => el.classList.remove('active'));
};

// ── DM mesajlarını dinle ──
function listenDmMessages(roomId) {
  const msgsQuery = query(ref(db, `dm_messages/${roomId}`), orderByKey(), limitToLast(80));
  unsubDmMessages = onValue(msgsQuery, snapshot => {
    const data = snapshot.val() || {};
    const entries = Object.entries(data).sort((a, b) => a[1].ts - b[1].ts);
    renderDmMessages(entries);
  });
}

function renderDmMessages(entries) {
  const container = document.getElementById('messagesContainer');
  container.innerHTML = '<div class="day-divider">Özel Mesajlar</div>';
  let prevAuthor = null;
  let currentGroup = null;

  entries.forEach(([key, msg]) => {
    if (msg.type === 'system') {
      const div = document.createElement('div');
      div.className = 'sys-msg';
      div.textContent = msg.text || '';
      container.appendChild(div);
      prevAuthor = null;
      currentGroup = null;
      return;
    }

    const isOwn = msg.author === currentUser?.name;

    // Yeni grup başlat mı?
    if (msg.author !== prevAuthor || !currentGroup) {
      currentGroup = document.createElement('div');
      currentGroup.className = 'msg-group' + (isOwn ? ' own' : '');
      const header = document.createElement('div');
      header.className = 'msg-group-header';

      const av = document.createElement('div');
      av.className = 'msg-avatar';
      if (msg.photoData) av.innerHTML = `<img src="${msg.photoData}" alt="pp"/>`;
      else av.textContent = msg.avatar || '🧑';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'msg-author';
      nameSpan.textContent = msg.author;

      const timeSpan = document.createElement('span');
      timeSpan.className = 'msg-time';
      const d = new Date(msg.ts);
      timeSpan.textContent = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');

      header.appendChild(av);
      header.appendChild(nameSpan);
      header.appendChild(timeSpan);
      currentGroup.appendChild(header);
      container.appendChild(currentGroup);
    }

    const bw = document.createElement('div');
    bw.className = 'msg-bw';

    if (msg.type === 'image' && msg.imgData) {
      const img = document.createElement('img');
      img.className = 'msg-img' + (isOwn ? ' own' : '');
      img.src = msg.imgData;
      img.onclick = () => { openImgViewer(msg.imgData); };
      bw.appendChild(img);
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble' + (isOwn ? ' own' : '');
      bubble.textContent = msg.text || '';
      if(msg.edited){const et=document.createElement('span');et.className='edited-tag';et.textContent='(düzenlendi)';bubble.appendChild(et);}
      bw.appendChild(bubble);
    }

    appendMsgActions(bw, key, msg, isOwn);
    currentGroup.appendChild(bw);
    renderReactions(currentGroup, key, msg.reactions, isOwn);

    prevAuthor = msg.author;
  });

  const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  if(distFromBottom < 180) {
    container.scrollTop = container.scrollHeight;
  }
}

// ── DM Sesli Sohbet Başlat ──
window.startDmCall = () => {
  if (!currentDmRoom) return;
  joinVoiceChannel('dm-' + currentDmRoom);
};

// ── DM mesaj gönder ──
window.sendDmMessage = async (text) => {
  if (!currentUser || !currentDmRoom || !text) return;

  const msgData = {
    type: 'user',
    author: currentUser.name,
    avatar: currentUser.avatar,
    photoData: currentUser.photoData || null,
    text: text,
    ts: Date.now()
  };

  await push(ref(db, `dm_messages/${currentDmRoom}`), msgData);

  // Room meta güncelle
  await set(ref(db, `dm_rooms/${currentDmRoom}/lastMessage`), text.substring(0, 50));
  await set(ref(db, `dm_rooms/${currentDmRoom}/lastMessageBy`), currentUser.name);
  await set(ref(db, `dm_rooms/${currentDmRoom}/lastMessageTs`), Date.now());

  // Karşı tarafın unread sayısını artır
  const roomSnap = await get(ref(db, `dm_rooms/${currentDmRoom}`));
  const roomData = roomSnap.val();
  if (roomData?.participantList) {
    const partner = roomData.participantList.find(n => n !== currentUser.name);
    if (partner) {
      const unreadRef = ref(db, `dm_unread/${partner}/${currentDmRoom}`);
      const unreadSnap = await get(unreadRef);
      const cur = unreadSnap.val() || 0;
      await set(unreadRef, cur + 1);
    }
  }
};

// ── Okunmamış sıfırla ──
function markDmAsRead(roomId) {
  if (!currentUser) return;
  set(ref(db, `dm_unread/${currentUser.name}/${roomId}`), 0);
}

// ── DM odalarını dinle (sidebar) ──
function listenMyDmRooms() {
  if (!currentUser) return;

  // Tüm dm_rooms'u dinle ve sadece benim katıldıklarımı filtrele
  if (unsubDmRooms) { unsubDmRooms(); unsubDmRooms = null; }

  unsubDmRooms = onValue(ref(db, 'dm_rooms'), snap => {
    const allRooms = snap.val() || {};
    dmRoomsCache = {};
    Object.entries(allRooms).forEach(([id, data]) => {
      if (data.participants && data.participants[currentUser.name]) {
        dmRoomsCache[id] = data;
      }
    });
    renderDmSidebar();
  });

  // Unread sayılarını dinle
  onValue(ref(db, `dm_unread/${currentUser.name}`), snap => {
    const unreadData = snap.val() || {};
    // Re-render sidebar with unread counts
    renderDmSidebar(unreadData);
  });
}

// ── DM sidebar render ──
function renderDmSidebar(unreadData) {
  const list = document.getElementById('dmList');
  if (!list) return;
  list.innerHTML = '';

  // Son mesaja göre sırala (en yeni üstte)
  const rooms = Object.entries(dmRoomsCache).sort((a, b) => (b[1].lastMessageTs || 0) - (a[1].lastMessageTs || 0));

  if (rooms.length === 0) {
    list.innerHTML = '<div style="padding:4px 8px;font-size:0.72rem;color:var(--muted)">Henüz DM yok</div>';
    return;
  }

  rooms.forEach(([roomId, data]) => {
    const partnerName = getDmPartnerName(data);
    const partnerOnline = !!onlineUsersCache[partnerName];
    const partnerData = onlineUsersCache[partnerName] || {};
    const unread = unreadData?.[roomId] || 0;

    const item = document.createElement('div');
    item.className = 'dm-item' + (currentDmRoom === roomId ? ' active' : '');
    item.dataset.roomId = roomId;
    item.onclick = () => switchToDm(roomId, partnerName, partnerData);

    // Avatar with online dot
    const avWrap = document.createElement('div');
    avWrap.style.cssText = 'position:relative;flex-shrink:0;';
    const av = document.createElement('div');
    av.className = 'dm-item-av';
    if (partnerData.photoData) av.innerHTML = `<img src="${partnerData.photoData}" alt="pp"/>`;
    else av.textContent = partnerData.avatar || partnerName.charAt(0).toUpperCase();
    const dot = document.createElement('div');
    dot.className = 'dm-online-dot ' + (partnerOnline ? 'online' : 'offline');
    avWrap.appendChild(av);
    avWrap.appendChild(dot);

    // Info (name + snippet)
    const info = document.createElement('div');
    info.className = 'dm-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'dm-item-name';
    nameEl.textContent = partnerName;
    info.appendChild(nameEl);
    if (data.lastMessage) {
      const snippet = document.createElement('div');
      snippet.className = 'dm-item-snippet';
      snippet.textContent = (data.lastMessageBy === currentUser?.name ? 'Sen: ' : '') + data.lastMessage;
      info.appendChild(snippet);
    }

    item.appendChild(avWrap);
    item.appendChild(info);

    // Unread badge
    if (unread > 0) {
      const badge = document.createElement('div');
      badge.className = 'dm-unread-badge';
      badge.textContent = unread > 99 ? '99+' : unread;
      item.appendChild(badge);
    }

    list.appendChild(item);
  });
}

// ── Mevcut sendMessage'ı DM desteğiyle güçlendir ──
const _originalSendMessage = window.sendMessage;
window.sendMessage = async () => {
  if (dmMode && currentDmRoom) {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text || !currentUser || text.length > 2000) return;
    input.value = '';
    input.style.height = 'auto';
    await sendDmMessage(text);
  } else {
    // Orijinal kanal mesaj gönderme
    await _originalSendMessage();
  }
};

// ── Mevcut switchChannel'ı DM'den çıkma desteğiyle güçlendir ──
// switchChannel zaten var, onu wrap ediyoruz
const _origSwitchChannelRef = window.switchChannel || null;
// switchChannel global bir fonksiyon olarak tanımlı değilse (module scope'ta),
// bu kısım renderChannels içinden çağrıldığında çalışır.
// Bunun yerine, kanal tıklandığında dmMode'u sıfırla.

// Online kullanıcıları cache'le (DM modal için)
const _origListenOnline = window.listenOnline;
// listenOnline modül scopeta tanımlı, onValue içinde onlineUsersCache güncellenir.
// Bunu ayrıca yapıyoruz:
onValue(ref(db, 'online'), snap => {
  onlineUsersCache = snap.val() || {};
});