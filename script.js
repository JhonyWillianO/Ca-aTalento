function readSavedProfile() {
  try {
    return JSON.parse(localStorage.getItem("talent-profile") || "{}");
  } catch {
    return {};
  }
}

function makeId() {
  const safeCrypto = window.crypto || window.msCrypto;
  if (safeCrypto && safeCrypto.randomUUID) return safeCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (safeCrypto && safeCrypto.getRandomValues) safeCrypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("") || `${Date.now()}-${Math.random()}`;
}

function createSyncChannel() {
  if (!("BroadcastChannel" in window)) {
    return { postMessage() {}, addEventListener() {} };
  }

  try {
    return new BroadcastChannel("talent-room-sync");
  } catch {
    return { postMessage() {}, addEventListener() {} };
  }
}

const savedProfile = readSavedProfile();

const app = {
  profile: {
    id: savedProfile.id || makeId(),
    name: savedProfile.name || "",
    photo: savedProfile.photo || "",
    role: savedProfile.role || "student",
    roomCode: savedProfile.roomCode || ""
  },
  room: null,
  selectedRoom: "",
  channel: createSyncChannel()
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const screens = {
  welcome: $('[data-screen="welcome"]'),
  room: $('[data-screen="room"]'),
  stage: $('[data-screen="stage"]'),
  scoreboard: $('[data-screen="scoreboard"]')
};

const CRITERIA = [
  { key: "technique", label: "Tecnica" },
  { key: "expression", label: "Interpretacao" },
  { key: "stagePresence", label: "Palco" },
  { key: "creativity", label: "Criatividade" }
];

const PUBLIC_VOTES = {
  bad: { label: "Ruim", value: 0 },
  good: { label: "Bom", value: 70 },
  great: { label: "Maravilhoso", value: 100 }
};

const BLOCKED_WORDS = [
  "arrombado",
  "boquete",
  "buceta",
  "cacete",
  "caralho",
  "fdp",
  "foda",
  "fodase",
  "gozar",
  "merda",
  "nude",
  "nudes",
  "pau",
  "pelada",
  "pelado",
  "pinto",
  "porn",
  "porno",
  "porra",
  "puta",
  "puto",
  "rola",
  "sexo",
  "vtnc"
];

const IMAGE_BLOCKED_TERMS = ["18", "adult", "nude", "nudes", "pelada", "pelado", "porn", "porno", "sexo", "xxx"];

const SOUND_FILES = {
  drumRoll: "./scratchonix-drum-roll-for-victory-366448.mp3",
  fanfare: "./u_ss015dykrt-brass-fanfare-with-timpani-and-winchimes-reverberated-146260.mp3",
  victory: "./u_it78ck90s3-orchestral-win-331233.mp3",
  defeat: "./coghezzi-game-over-orchestral-stinger-cartoon-defeat-546515.mp3",
  voteBad: "./freesound_community-boo-6377.mp3",
  voteGood: "./freesound_community-palmas-maesaif-14571.mp3",
  voteGreat: "./driken5482-applause-cheer-236786.mp3"
};

let scannerStream = null;
let scannerTimer = null;
const USE_REMOTE_STORAGE = location.protocol.startsWith("http");
let audioContext = null;
let knownParticipantIds = new Set();
let lastUiSoundAt = 0;
let lastRangeSoundAt = 0;
let scoreboardRevealKey = "";
let scoreboardRevealComplete = false;
let scoreboardRevealTimers = [];
let scoreboardRevealedRanks = new Set();
let scoreboardDomKey = "";
let noticeTimer = null;
let activeMediaAudio = null;
let activeMediaTimers = [];

function cleanText(value = "", maxLength = 80) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeModerationText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[@4]/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[3]/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/[^a-z0-9]+/g, "");
}

function hasBlockedText(value) {
  const text = normalizeModerationText(value);
  if (!text) return false;
  return BLOCKED_WORDS.some((word) => text.includes(normalizeModerationText(word)));
}

function hasBlockedImageName(file) {
  const name = normalizeModerationText((file && file.name) || "");
  return IMAGE_BLOCKED_TERMS.some((term) => name.includes(normalizeModerationText(term)));
}

function imageLooksUnsafe(ctx, size) {
  let sampled = 0;
  let skinPixels = 0;
  const step = 8;
  const pixels = ctx.getImageData(0, 0, size, size).data;

  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const offset = (y * size + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const isSkinLike = red > 95 && green > 40 && blue > 20 && max - min > 15 && red > green && red > blue;
      sampled += 1;
      if (isSkinLike) skinPixels += 1;
    }
  }

  return sampled > 0 && skinPixels / sampled > 0.62;
}

function ensureNoticeLayer() {
  let layer = $("#noticeLayer");
  if (layer) return layer;

  layer = document.createElement("div");
  layer.id = "noticeLayer";
  layer.className = "notice-layer";
  layer.innerHTML = `
    <div class="notice-banner" id="noticeBanner" role="status">
      <strong id="noticeTitle"></strong>
      <span id="noticeMessage"></span>
    </div>
    <div class="confirm-panel" id="confirmPanel" role="dialog" aria-modal="true">
      <div>
        <strong id="confirmTitle"></strong>
        <p id="confirmMessage"></p>
      </div>
      <div class="confirm-actions">
        <button class="test-button" id="confirmCancel">CANCELAR</button>
        <button class="danger-button" id="confirmOk">CONFIRMAR</button>
      </div>
    </div>
  `;
  document.body.append(layer);
  return layer;
}

function showNotice(message, title = "Aviso", type = "info") {
  const layer = ensureNoticeLayer();
  const banner = $("#noticeBanner");
  window.clearTimeout(noticeTimer);

  banner.className = `notice-banner is-active ${type}`;
  $("#noticeTitle").textContent = title;
  $("#noticeMessage").textContent = message;
  layer.classList.add("has-banner");
  playActionSound();

  noticeTimer = window.setTimeout(() => {
    banner.classList.remove("is-active");
    layer.classList.remove("has-banner");
  }, 4200);
}

function askConfirm(message, title = "Confirmar") {
  const layer = ensureNoticeLayer();
  const panel = $("#confirmPanel");
  const ok = $("#confirmOk");
  const cancel = $("#confirmCancel");

  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  layer.classList.add("is-confirming");
  panel.classList.add("is-active");
  playActionSound();

  return new Promise((resolve) => {
    const finish = (answer) => {
      panel.classList.remove("is-active");
      layer.classList.remove("is-confirming");
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      resolve(answer);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
  });
}

function ensureAudio() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioContext) audioContext = new AudioCtor();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

function stopMediaAudio() {
  activeMediaTimers.forEach((timer) => window.clearTimeout(timer));
  activeMediaTimers = [];

  if (!activeMediaAudio) return;
  activeMediaAudio.pause();
  activeMediaAudio.currentTime = 0;
  activeMediaAudio = null;
}

function playAudioFile(src, volume = 0.82) {
  ensureAudio();
  stopMediaAudio();
  const audio = new Audio(src);
  audio.volume = volume;
  activeMediaAudio = audio;
  audio.addEventListener("ended", () => {
    if (activeMediaAudio === audio) activeMediaAudio = null;
  });
  audio.play().catch(() => {});
  return audio;
}

function playTone(frequency, start, duration, type = "sine", gain = 0.12) {
  const ctx = ensureAudio();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + start);
  volume.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  volume.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
  volume.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  oscillator.connect(volume).connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration + 0.02);
}

function playNoiseBurst(start, duration, gain = 0.16, filterFrequency = 1600) {
  const ctx = ensureAudio();
  if (!ctx) return;

  const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const volume = ctx.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = filterFrequency;
  volume.gain.value = gain;
  source.connect(filter).connect(volume).connect(ctx.destination);
  source.start(ctx.currentTime + start);
}

function playJoinSound() {
  playTone(440, 0, 0.1, "triangle", 0.1);
  playTone(660, 0.08, 0.12, "triangle", 0.12);
  playTone(880, 0.18, 0.18, "triangle", 0.1);
}

function playUiClickSound() {
  const now = performance.now();
  if (now - lastUiSoundAt < 70) return;
  lastUiSoundAt = now;
  playTone(720, 0, 0.045, "triangle", 0.045);
  playTone(980, 0.04, 0.055, "triangle", 0.035);
}

function playActionSound() {
  playTone(520, 0, 0.08, "triangle", 0.08);
  playTone(1040, 0.08, 0.12, "triangle", 0.08);
}

function playAdvanceSound() {
  playTone(392, 0, 0.08, "square", 0.05);
  playTone(523, 0.08, 0.08, "square", 0.05);
  playTone(784, 0.16, 0.16, "triangle", 0.08);
}

function playFinishSound() {
  playGoodVoteSound();
  playTone(523, 0.08, 0.16, "triangle", 0.08);
  playTone(659, 0.2, 0.16, "triangle", 0.08);
  playTone(784, 0.32, 0.24, "triangle", 0.1);
}

function playFinalResultSound(ranking) {
  const bestScore = ranking[0] && ranking[0].finalScore;
  const winnerIds = ranking
    .filter((student) => scoresAreTied(student.finalScore, bestScore))
    .map((student) => student.id);
  const shouldCelebrate = app.profile.role === "teacher" || app.profile.role === "viewer" || winnerIds.includes(app.profile.id);

  if (shouldCelebrate) {
    playAudioFile(SOUND_FILES.victory, 0.86);
  } else {
    playAudioFile(SOUND_FILES.defeat, 0.84);
  }
}

function playRemoveSound() {
  playTone(220, 0, 0.08, "sawtooth", 0.06);
  playTone(160, 0.08, 0.12, "sawtooth", 0.045);
}

function playRangeSound() {
  const now = performance.now();
  if (now - lastRangeSoundAt < 90) return;
  lastRangeSoundAt = now;
  playTone(360 + Math.random() * 260, 0, 0.035, "sine", 0.035);
}

function playBadVoteSound() {
  playAudioFile(SOUND_FILES.voteBad, 0.76);
}

function playGoodVoteSound() {
  playAudioFile(SOUND_FILES.voteGood, 0.78);
}

function playGreatVoteSound() {
  playAudioFile(SOUND_FILES.voteGreat, 0.82);
}

function playAudienceVoteSound(vote) {
  if (vote === "bad") playBadVoteSound();
  if (vote === "good") playGoodVoteSound();
  if (vote === "great") playGreatVoteSound();
}

function syncParticipantJoinSounds(room, playSound = true) {
  const ids = new Set(Object.keys((room && room.participants) || {}));
  const hasNewRemotePerson = [...ids].some((id) => !knownParticipantIds.has(id) && id !== app.profile.id);

  if (playSound && knownParticipantIds.size > 0 && hasNewRemotePerson) playJoinSound();
  knownParticipantIds = ids;
}

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove("is-active"));
  screens[name].classList.add("is-active");
  if (name === "room") renderRoomEntry();
}

function normalizeCode(value) {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
}

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function saveProfile() {
  localStorage.setItem("talent-profile", JSON.stringify(app.profile));
}

function defaultAvatar(role) {
  const label = role === "teacher" ? "P" : role === "viewer" ? "C" : "A";
  const primary = role === "teacher" ? "#12844f" : role === "viewer" ? "#7b5eea" : "#0b78f0";

  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <rect width="160" height="160" rx="80" fill="${primary}"/>
      <circle cx="80" cy="80" r="56" fill="#ffffff" opacity="0.95"/>
      <text x="80" y="98" text-anchor="middle" font-size="58" font-family="Arial" font-weight="700" fill="${primary}">${label}</text>
    </svg>
  `)}`;
}

function avatarFor(person) {
  return (person && person.photo) || defaultAvatar((person && person.role) || "student");
}

function roomKey(code) {
  return `talent-room-${code}`;
}

function getLocalRoom(code) {
  const saved = localStorage.getItem(roomKey(code));
  if (!saved) return null;
  try {
    return JSON.parse(saved);
  } catch {
    localStorage.removeItem(roomKey(code));
    return null;
  }
}

function localRooms() {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith("talent-room-"))
    .map((key) => {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch {
        localStorage.removeItem(key);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function loadRoom(code) {
  const cleanCode = normalizeCode(code);
  if (USE_REMOTE_STORAGE) {
    try {
      const response = await fetch(`/api/rooms/${cleanCode}`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        if (data.room) {
          localStorage.setItem(roomKey(cleanCode), JSON.stringify(data.room));
          return data.room;
        }
      }
      if (response.status === 404) return null;
    } catch {
      // Local fallback keeps the app usable when opened outside Netlify.
    }
  }

  return getLocalRoom(cleanCode);
}

async function loadRooms() {
  if (USE_REMOTE_STORAGE) {
    try {
      const response = await fetch("/api/rooms", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        return (data.rooms || []).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      }
    } catch {
      // Local fallback below.
    }
  }

  return localRooms();
}

async function deleteRoom(code) {
  const cleanCode = normalizeCode(code);
  localStorage.removeItem(roomKey(cleanCode));

  if (USE_REMOTE_STORAGE) {
    try {
      await fetch(`/api/rooms/${cleanCode}`, { method: "DELETE" });
    } catch {
      // Local cleanup is enough when offline.
    }
  }
}

async function saveRoom(room, options = {}) {
  const { activity = true } = options;
  if (activity) room.lastActivityAt = Date.now();
  room.updatedAt = Date.now();
  localStorage.setItem(roomKey(room.code), JSON.stringify(room));
  app.room = room;

  if (USE_REMOTE_STORAGE) {
    try {
      const response = await fetch(`/api/rooms/${room.code}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(room)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.room) app.room = data.room;
      } else {
        const data = await response.json().catch(() => ({}));
        showNotice(data.error || "Nao foi possivel salvar a sala agora.", "Erro na sala", "danger");
      }
    } catch {
      // The local copy remains available if the network briefly fails.
      showNotice("Conexao instavel. A sala foi salva neste aparelho e tentara sincronizar depois.", "Sem conexao", "warning");
    }
  }

  app.channel.postMessage({ code: room.code });
}

function createRoom(code) {
  const now = Date.now();
  return {
    code,
    status: "live",
    ownerId: app.profile.role === "teacher" ? app.profile.id : "",
    ownerName: app.profile.role === "teacher" ? app.profile.name : "",
    roundId: makeId(),
    roundStartedAt: now,
    currentIndex: 0,
    participants: {},
    removedParticipantIds: [],
    queue: [],
    scores: {},
    nextVotes: {},
    audienceVotes: {},
    events: [],
    createdAt: now,
    lastActivityAt: now,
    updatedAt: now
  };
}

function profileReady() {
  const typedName = cleanText($("#nameInput").value, 32);
  if (hasBlockedText(typedName)) {
    showNotice("Escolha um nick respeitoso para participar do projeto.", "Nome bloqueado", "warning");
    return false;
  }

  app.profile.name = typedName || randomName();
  app.profile.photo = String(app.profile.photo || "").length > 260000 ? "" : app.profile.photo;
  $("#nameInput").value = app.profile.name;
  saveProfile();
  updateHeader();
  return true;
}

function randomName() {
  const roleName = app.profile.role === "teacher" ? "Professor" : app.profile.role === "viewer" ? "Convidado" : "Aluno";
  return `${roleName}${Math.floor(1000 + Math.random() * 9000)}`;
}

function updateHeader() {
  $("#headerName").textContent = app.profile.name || "Visitante";
  $("#profilePhoto").src = avatarFor(app.profile);
  $("#nameInput").value = app.profile.name || "";
}

function syncRoleButtons() {
  $$(".role-pill").forEach((item) => {
    item.classList.toggle("is-selected", item.dataset.role === app.profile.role);
  });
}

function addEvent(room, text) {
  room.events = room.events || [];
  room.events.unshift({ id: makeId(), type: "system", text, at: Date.now() });
  room.events = room.events.slice(0, 60);
}

function addChatMessage(room, text) {
  const safeText = cleanText(text, 180);
  if (!safeText) return;

  room.events = room.events || [];
  room.events.unshift({
    id: makeId(),
    type: "chat",
    text: safeText,
    author: app.profile.name,
    roleLabel: roleLabel(app.profile.role),
    role: app.profile.role,
    at: Date.now()
  });
  room.events = room.events.slice(0, 60);
}

function upsertParticipant(room) {
  const previous = room.participants[app.profile.id];
  room.participants[app.profile.id] = {
    id: app.profile.id,
    name: cleanText(app.profile.name, 32),
    photo: String(app.profile.photo || "").length > 260000 ? "" : app.profile.photo,
    role: app.profile.role,
    joinedAt: (previous && previous.joinedAt) || Date.now(),
    lastSeenAt: Date.now()
  };

  if (!previous) addEvent(room, `${app.profile.name} entrou como ${roleLabel(app.profile.role)}.`);
  return !previous;
}

function roleLabel(role) {
  if (role === "teacher") return "professor";
  if (role === "viewer") return "convidado";
  if (role === "student") return "aluno";
  return "visitante";
}

async function joinRoom(code, shouldCreate = false) {
  if (!profileReady()) return;

  const cleanCode = shouldCreate ? normalizeCode(code || makeCode()) : normalizeCode(code);
  if (!cleanCode) {
    showNotice("Digite ou escolha o codigo de uma sala.", "Codigo obrigatorio", "warning");
    return;
  }

  let room = await loadRoom(cleanCode);

  if (!room && shouldCreate) room = createRoom(cleanCode);

  if (!room) {
    showNotice("Sala nao encontrada. Confira o codigo ou peça um novo codigo ao professor.", "Sala indisponivel", "warning");
    return;
  }

  const enteredNow = upsertParticipant(room);
  if (app.profile.role === "student" && !room.queue.includes(app.profile.id)) {
    room.queue.push(app.profile.id);
  }

  app.profile.roomCode = cleanCode;
  app.selectedRoom = cleanCode;
  saveProfile();
  await saveRoom(room);
  if (enteredNow) playJoinSound();
  syncParticipantJoinSounds(app.room, false);
  render();
  showScreen(room.status === "finished" ? "scoreboard" : "stage");
}

async function createUniqueRoomCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = makeCode();
    const existing = await loadRoom(code);
    if (!existing) return code;
  }

  return makeCode();
}

function currentStudent(room = app.room) {
  if (!room || room.queue.length === 0) return null;
  return room.participants[room.queue[room.currentIndex]] || null;
}

function teachers(room = app.room) {
  return Object.values((room && room.participants) || {}).filter((person) => person.role === "teacher");
}

function students(room = app.room) {
  return ((room && room.queue) || []).map((id) => room.participants[id]).filter(Boolean);
}

function roomOwnerId(room = app.room) {
  if (room && room.ownerId) return room.ownerId;
  const firstTeacher = teachers(room).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  return (firstTeacher && firstTeacher.id) || "";
}

function isRoomOwner(room = app.room) {
  return app.profile.role === "teacher" && roomOwnerId(room) === app.profile.id;
}

function resetRoomForNewRound(room) {
  room.status = "live";
  room.roundId = makeId();
  room.roundStartedAt = Date.now();
  room.currentIndex = 0;
  room.scores = {};
  room.nextVotes = {};
  room.audienceVotes = {};
  room.events = [];
  room.queue = Object.values(room.participants)
    .filter((person) => person.role === "student")
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((person) => person.id);
  addEvent(room, "O professor recomecou o show.");
}

function studentScores(studentId, room = app.room) {
  return Object.values(((room && room.scores && room.scores[studentId]) || {}));
}

function scoreTotal(score) {
  if (typeof score === "number") return score * CRITERIA.length;
  return CRITERIA.reduce((sum, criterion) => sum + Number((score && score[criterion.key]) || 0), 0);
}

function criterionAverage(studentId, criterionKey, room = app.room) {
  const values = studentScores(studentId, room);
  if (!values.length) return 0;

  const total = values.reduce((sum, score) => {
    if (typeof score === "number") return sum + Number(score);
    return sum + Number((score && score[criterionKey]) || 0);
  }, 0);

  return total / values.length;
}

function average(studentId, room = app.room) {
  const values = studentScores(studentId, room);
  if (!values.length) return 0;
  return values.reduce((sum, score) => sum + scoreTotal(score), 0) / values.length;
}

function finalRanking(room = app.room) {
  return students(room)
    .map((student) => ({
      ...student,
      finalScore: average(student.id, room),
      tieBreakers: CRITERIA.map((criterion) => criterionAverage(student.id, criterion.key, room))
    }))
    .sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return a.name.localeCompare(b.name);
    });
}

function scoresAreTied(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.001;
}

function rankedResults(room = app.room) {
  let currentPlacement = 0;
  let previousScore = null;

  return finalRanking(room).map((student, index) => {
    if (previousScore === null || !scoresAreTied(student.finalScore, previousScore)) {
      currentPlacement = index + 1;
      previousScore = student.finalScore;
    }

    return { ...student, placement: currentPlacement };
  });
}

function audienceVotesFor(studentId, room = app.room) {
  return Object.values(((room && room.audienceVotes && room.audienceVotes[studentId]) || {}));
}

function audienceApproval(studentId, room = app.room) {
  const votes = audienceVotesFor(studentId, room);
  if (!votes.length) return { percent: 0, count: 0, label: "Sem votos do publico" };

  const total = votes.reduce((sum, vote) => sum + ((PUBLIC_VOTES[vote] && PUBLIC_VOTES[vote].value) || 0), 0);
  const percent = Math.round(total / votes.length);
  return { percent, count: votes.length, label: `${percent}% aprovacao do publico` };
}

function viewerVotedStudent(studentId, viewerId = app.profile.id, room = app.room) {
  return Boolean(room && room.audienceVotes && room.audienceVotes[studentId] && room.audienceVotes[studentId][viewerId] !== undefined);
}

function currentCriteriaScore() {
  return Object.fromEntries(
    $$("[data-criterion]").map((input) => [input.dataset.criterion, Number(input.value)])
  );
}

function updateScoreTotal() {
  const score = currentCriteriaScore();
  const total = scoreTotal(score);
  $("#scoreValue").textContent = total.toFixed(1);

  $$("[data-criterion]").forEach((input) => {
    const output = input.closest(".score-control").querySelector("output");
    output.textContent = Number(input.value).toFixed(1);
  });
}

function teacherVoteStatus(studentId, room = app.room) {
  const teacherList = teachers(room);
  const votedCount = teacherList.filter((teacher) => room && room.scores && room.scores[studentId] && room.scores[studentId][teacher.id] !== undefined).length;
  return { votedCount, total: teacherList.length, complete: teacherList.length > 0 && votedCount === teacherList.length };
}

function teacherScoredStudent(studentId, teacherId = app.profile.id, room = app.room) {
  return Boolean(room && room.scores && room.scores[studentId] && room.scores[studentId][teacherId] !== undefined);
}

function teacherNextStatus(studentId, room = app.room) {
  const teacherList = teachers(room);
  const confirmedCount = teacherList.filter((teacher) => room && room.nextVotes && room.nextVotes[studentId] && room.nextVotes[studentId][teacher.id]).length;
  return {
    confirmedCount,
    total: teacherList.length,
    complete: teacherList.length > 0 && confirmedCount === teacherList.length
  };
}

function teacherConfirmedNext(studentId, teacherId = app.profile.id, room = app.room) {
  return Boolean(room && room.nextVotes && room.nextVotes[studentId] && room.nextVotes[studentId][teacherId]);
}

function isLastStudent(room = app.room) {
  return !room || room.queue.length === 0 || room.currentIndex >= room.queue.length - 1;
}

function removeParticipantRecords(room, participantId) {
  const participant = room.participants && room.participants[participantId];
  if (!participant) return null;

  delete room.participants[participantId];
  room.queue = (room.queue || []).filter((id) => id !== participantId);
  if (room.currentIndex >= room.queue.length) {
    room.currentIndex = Math.max(0, room.queue.length - 1);
  }

  if (room.scores) delete room.scores[participantId];
  if (room.audienceVotes) delete room.audienceVotes[participantId];
  if (room.nextVotes) delete room.nextVotes[participantId];

  Object.values(room.scores || {}).forEach((scoreByTeacher) => delete scoreByTeacher[participantId]);
  Object.values(room.audienceVotes || {}).forEach((voteByViewer) => delete voteByViewer[participantId]);
  Object.values(room.nextVotes || {}).forEach((nextByTeacher) => delete nextByTeacher[participantId]);

  return participant;
}

function transferRoomOwnerIfNeeded(room, leavingId) {
  if (roomOwnerId(room) !== leavingId) return;

  const nextTeacher = teachers(room)
    .filter((teacher) => teacher.id !== leavingId)
    .sort((a, b) => a.joinedAt - b.joinedAt)[0];

  room.ownerId = nextTeacher ? nextTeacher.id : "";
  room.ownerName = nextTeacher ? nextTeacher.name : "";
}

function removeParticipantFromRoom(room, participantId) {
  const participant = room.participants && room.participants[participantId];
  if (!participant || participantId === roomOwnerId(room)) return false;

  room.removedParticipantIds = room.removedParticipantIds || [];
  if (!room.removedParticipantIds.includes(participantId)) {
    room.removedParticipantIds.push(participantId);
  }

  removeParticipantRecords(room, participantId);
  addEvent(room, `${participant.name} foi removido da sala pelo organizador.`);
  return true;
}

async function leaveCurrentRoom() {
  if (!app.room || !app.room.code) {
    showScreen("room");
    return;
  }

  const confirmed = await askConfirm("Realmente quer sair da sala?", "Sair da sala");
  if (!confirmed) return;

  const code = app.room.code;
  const room = await loadRoom(code);
  if (room && room.participants && room.participants[app.profile.id]) {
    const participant = room.participants[app.profile.id];
    transferRoomOwnerIfNeeded(room, app.profile.id);
    removeParticipantRecords(room, app.profile.id);
    room.leftParticipantIds = [app.profile.id];
    addEvent(room, `${participant.name} saiu da sala.`);

    if (!teachers(room).length) {
      await deleteRoom(code);
    } else {
      await saveRoom(room);
    }
  }

  localStorage.removeItem(roomKey(code));
  app.room = null;
  app.selectedRoom = "";
  app.profile.roomCode = "";
  saveProfile();
  knownParticipantIds = new Set();
  $("#roomInput").value = "";
  $("#selectedRoomLabel").textContent = "---";
  showNotice("Voce saiu da sala.", "Sala", "info");
  showScreen("room");
}

async function advanceRoom(room) {
  if (!room) return;
  if (room.currentIndex < room.queue.length - 1) {
    room.currentIndex += 1;
    const next = currentStudent(room);
    addEvent(room, `${(next && next.name) || "Proximo aluno"} subiu ao palco.`);
  } else {
    room.status = "finished";
    addEvent(room, "Show finalizado. Placar liberado.");
  }
  await saveRoom(room);
}

async function syncActiveRoom() {
  if (!USE_REMOTE_STORAGE || !app.room || !app.room.code) return;

  const latest = await loadRoom(app.room.code);
  if (!latest) {
    app.room = null;
    app.profile.roomCode = "";
    saveProfile();
    showNotice("Esta sala foi fechada pelo organizador ou ficou inativa por muito tempo.", "Sala encerrada", "warning");
    showScreen("room");
    return;
  }

  if (latest.participants && !latest.participants[app.profile.id]) {
    app.room = null;
    app.profile.roomCode = "";
    showNotice("Voce foi removido da sala pelo professor organizador.", "Participante removido", "danger");
    showScreen("room");
    return;
  }

  const previousStatus = app.room.status;
  app.room = latest;
  syncParticipantJoinSounds(latest);
  render();

  if (latest.status !== previousStatus) {
    showScreen(latest.status === "finished" ? "scoreboard" : "stage");
  }
}

async function sendPresenceHeartbeat() {
  if (!USE_REMOTE_STORAGE || !app.room || !app.room.code || !app.room.participants || !app.room.participants[app.profile.id]) return;

  const room = await loadRoom(app.room.code);
  if (!room || !room.participants || !room.participants[app.profile.id]) return;
  upsertParticipant(room);
  await saveRoom(room, { activity: false });
}

function renderEmpty(target) {
  target.append($("#emptyItem").content.cloneNode(true));
}

function personLine(person, metaText, options = {}) {
  const li = document.createElement("li");
  const image = document.createElement("img");
  const body = document.createElement("div");
  const name = document.createElement("strong");
  const meta = document.createElement("span");

  image.src = avatarFor(person);
  image.alt = "";
  name.textContent = person.name;
  meta.className = "meta";
  meta.textContent = metaText;

  body.append(name, meta);
  li.append(image, body);

  if (options.removable) {
    const button = document.createElement("button");
    li.classList.add("participant-line", "has-remove");
    button.className = "remove-button";
    button.type = "button";
    button.title = `Remover ${person.name}`;
    button.textContent = "X";
    button.dataset.removeParticipant = person.id;
    li.append(button);
  }

  return li;
}

function canRemoveParticipant(person) {
  return isRoomOwner() && person.id !== app.profile.id;
}

async function renderRooms() {
  const grid = $("#roomGrid");
  const filter = normalizeCode($("#roomInput").value);
  const rooms = (await loadRooms()).filter((room) => !filter || room.code.includes(filter));
  grid.innerHTML = "";

  if (!rooms.length) {
    const empty = document.createElement("div");
    empty.className = "room-card";
    empty.innerHTML = '<div class="room-icon">+</div><strong>Nenhuma sala</strong><span>Crie uma nova</span>';
    grid.append(empty);
    return;
  }

  rooms.forEach((room) => {
    const card = document.createElement("button");
    const peopleCount = Object.keys(room.participants || {}).length;
    const studentCount = (room.queue && room.queue.length) || 0;
    card.className = `room-card ${app.selectedRoom === room.code ? "is-selected" : ""}`;
    card.type = "button";
    card.innerHTML = `
      <div class="room-icon">${room.code.slice(0, 1)}</div>
      <strong>Show #${room.code}</strong>
      <div class="room-stats"><span>${peopleCount} online</span><span>${studentCount} alunos</span></div>
    `;
    card.addEventListener("click", () => {
      app.selectedRoom = room.code;
      $("#roomInput").value = room.code;
      $("#selectedRoomLabel").textContent = room.code;
      renderRooms();
    });
    grid.append(card);
  });
}

function renderRoomEntry() {
  stopScanner();
  const isTeacher = app.profile.role === "teacher";
  const isViewer = app.profile.role === "viewer";
  $("#roomScreenTitle").textContent = isTeacher ? "SALA DO PROFESSOR" : isViewer ? "ENTRADA DOS CONVIDADOS" : "ENTRADA DO ALUNO";
  $("#roomHelp").textContent = isTeacher
    ? "Crie uma sala nova, digite um codigo existente ou use o scanner de QR Code."
    : isViewer
      ? "Digite o codigo da sala ou use o scanner de QR Code."
      : "Aluno entra com o codigo enviado pelo professor ou pelo scanner de QR Code.";

  $("#createRoom").style.display = isTeacher ? "inline-block" : "none";
  $("#roomGrid").style.display = isTeacher ? "grid" : "none";
  $("#scannerBox").classList.add("is-active");
  renderRooms();
}

function renderQueue() {
  const list = $("#queueList");
  list.innerHTML = "";
  const performers = students();

  if (!performers.length) {
    renderEmpty(list);
    return;
  }

  performers.forEach((student, index) => {
    const state = index === app.room.currentIndex ? "apresentando" : index < app.room.currentIndex ? "concluido" : "aguardando";
    const points = average(student.id).toFixed(1);
    const publicScore = audienceApproval(student.id);
    list.append(personLine(student, `${points}/40 pts - ${state} - ${publicScore.label}`, {
      removable: canRemoveParticipant(student)
    }));
  });
}

function renderTeachers() {
  const list = $("#teacherList");
  list.innerHTML = "";
  const people = teachers();

  if (!people.length) {
    renderEmpty(list);
    return;
  }

  people.forEach((teacher) => {
    const performer = currentStudent();
    const gaveScore = performer && app.room.scores[performer.id] && app.room.scores[performer.id][teacher.id] !== undefined;
    list.append(personLine(teacher, gaveScore ? "nota enviada" : "aguardando nota", {
      removable: canRemoveParticipant(teacher)
    }));
  });
}

function renderGuests() {
  const list = $("#guestList");
  list.innerHTML = "";
  const guests = Object.values((app.room && app.room.participants) || {})
    .filter((person) => person.role === "viewer")
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!guests.length) {
    renderEmpty(list);
    return;
  }

  guests.forEach((guest) => {
    list.append(personLine(guest, "convidado", {
      removable: canRemoveParticipant(guest)
    }));
  });
}

function renderScores() {
  const list = $("#scoreList");
  list.innerHTML = "";
  const events = (app.room && app.room.events) || [];

  if (!events.length) {
    renderEmpty(list);
    return;
  }

  events.forEach((event) => {
    const li = document.createElement("li");
    const normalizedEvent = typeof event === "string" ? { type: "system", text: event } : event;

    if (normalizedEvent.type === "chat") {
      const author = document.createElement("span");
      const message = document.createElement("span");

      li.className = "chat-message";
      author.className = "chat-author";
      const label = (normalizedEvent.roleLabel || roleLabel(normalizedEvent.role || "") || "visitante").toUpperCase();
      author.textContent = `[${label}] ${normalizedEvent.author || "Visitante"}:`;
      message.textContent = normalizedEvent.text;
      li.append(author, message);
    } else {
      li.className = "system-message";
      li.textContent = normalizedEvent.text;
    }

    list.append(li);
  });
}

function clearScoreboardRevealTimers() {
  scoreboardRevealTimers.forEach((timer) => window.clearTimeout(timer));
  scoreboardRevealTimers = [];
}

function stopScoreboardReveal() {
  clearScoreboardRevealTimers();
  scoreboardRevealKey = currentScoreboardKey();
  scoreboardRevealComplete = false;
  scoreboardRevealedRanks = new Set();
  scoreboardDomKey = "";
}

function currentScoreboardKey(room = app.room) {
  return `${(room && room.code) || "local"}-${(room && room.roundId) || "round"}-${(room && room.status) || "live"}`;
}

function rankAwardAsset(rank) {
  if (rank === 1) return { symbol: "1", label: "Coroa de ouro", className: "gold", image: "./CoroaDeOuro.png" };
  if (rank === 2) return { symbol: "2", label: "Coroa de prata", className: "silver", image: "./CoroaDePrata.png" };
  if (rank === 3) return { symbol: "3", label: "Coroa de bronze", className: "bronze", image: "./CoroaDeBronze.png" };
  if (rank === 4) return { symbol: "4", label: "Medalha de quarto lugar", className: "medal-fourth", image: "./4Lugar.png" };
  return { symbol: "*", label: "Participante", className: "honor" };
}

function createRankingItem(student, index, options = {}) {
  const rank = options.rank || index + 1;
  const award = rankAwardAsset(rank);
  const li = document.createElement("li");
  const medal = document.createElement("span");
  const imageWrap = document.createElement("div");
  const awardBadge = document.createElement("span");
  const image = document.createElement("img");
  const body = document.createElement("div");
  const name = document.createElement("strong");
  const meta = document.createElement("span");

  li.className = `rank-card rank-${Math.min(rank, 4)} ${options.hidden ? "is-hidden" : "is-revealed"}${options.tieWinner ? " tie-winner" : ""}`;
  medal.className = "medal";
  medal.textContent = rank;
  imageWrap.className = "rank-photo";
  awardBadge.className = `rank-award ${award.className}`;
  awardBadge.title = award.label;
  if (award.image) {
    const awardImage = document.createElement("img");
    awardImage.src = award.image;
    awardImage.alt = award.label;
    awardBadge.append(awardImage);
  } else {
    awardBadge.textContent = award.symbol;
  }
  image.src = avatarFor(student);
  image.alt = "";
  name.textContent = student.name;
  meta.className = "meta";
  const publicScore = audienceApproval(student.id);
  meta.textContent = `Nota final ${student.finalScore.toFixed(1)} / 40 - ${publicScore.label}`;

  imageWrap.append(awardBadge, image);
  body.append(name, meta);
  li.append(medal, imageWrap, body);
  return li;
}

function revealScoreboardItems(items, ranking, key) {
  clearScoreboardRevealTimers();
  scoreboardRevealComplete = false;

  items.forEach(({ rank }, index) => {
    const delay = index * 1700 + 450;
    const timer = window.setTimeout(() => {
      if (scoreboardRevealKey !== key) return;

      if (rank === 1) playAudioFile(SOUND_FILES.drumRoll, 0.78);
      scoreboardRevealedRanks.add(rank);
      renderScoreboard();

      if (rank === 1) {
        const finalTimer = window.setTimeout(() => {
          if (scoreboardRevealKey !== key) return;
          scoreboardRevealComplete = true;
          playFinalResultSound(ranking);
          renderScoreboard();
        }, 2600);
        scoreboardRevealTimers.push(finalTimer);
      } else {
        playActionSound();
      }
    }, delay);
    scoreboardRevealTimers.push(timer);
  });
}

function renderRemainingRanking(ranking, canShow) {
  const target = $("#remainingRanking");
  const remaining = ranking.filter((student) => student.placement > 4);
  target.innerHTML = "";

  if (!remaining.length || !canShow) {
    target.classList.remove("is-active");
    return;
  }

  target.classList.add("is-active");
  const title = document.createElement("strong");
  const list = document.createElement("ol");
  title.textContent = "Demais participantes";

  remaining.forEach((student, index) => {
    list.append(createRankingItem(student, index, { rank: student.placement }));
  });

  target.append(title, list);
}

function renderScoreboard() {
  const podium = $("#podium");
  const revealKey = currentScoreboardKey();
  const isNewReveal = scoreboardRevealKey !== revealKey;

  if (!isNewReveal && scoreboardRevealComplete && scoreboardDomKey === revealKey && podium.children.length) {
    const owner = isRoomOwner();
    $("#finishActions").style.display = owner ? "grid" : "none";
    $("#waitingHost").textContent = "Aguardando o professor organizador iniciar outra rodada.";
    $("#waitingHost").classList.toggle("is-active", !owner);
    return;
  }

  podium.innerHTML = "";

  const ranking = rankedResults();
  const hasTieWinners = ranking.filter((student) => student.placement === 1).length > 1;
  podium.className = `podium dramatic-podium${hasTieWinners ? " has-tie-winners" : ""}`;

  if (!ranking.length) {
    renderEmpty(podium);
  } else {
    if (isNewReveal) {
      scoreboardRevealKey = revealKey;
      scoreboardRevealComplete = false;
      scoreboardRevealedRanks = new Set();
    }

    const topFour = ranking.filter((student) => student.placement <= 4);
    const revealOrder = [...new Set(topFour.map((student) => student.placement))].sort((a, b) => b - a);
    const revealItems = [];

    topFour.forEach((student, index) => {
      const rank = student.placement;
      const shouldHide = !scoreboardRevealComplete && !scoreboardRevealedRanks.has(rank);
      const item = createRankingItem(student, index, {
        hidden: shouldHide,
        rank,
        tieWinner: hasTieWinners && rank === 1
      });
      podium.append(item);
    });

    revealOrder.forEach((rank) => {
      revealItems.push({ rank });
    });

    if (isNewReveal) revealScoreboardItems(revealItems, ranking, revealKey);
  }

  renderRemainingRanking(ranking, scoreboardRevealComplete);
  const owner = isRoomOwner();
  $("#finishActions").style.display = owner ? "grid" : "none";
  $("#waitingHost").textContent = "Aguardando o professor organizador iniciar outra rodada.";
  $("#waitingHost").classList.toggle("is-active", !owner);
  renderPublicSummary();
  if (scoreboardRevealComplete) scoreboardDomKey = revealKey;
}

function renderPublicSummary() {
  const target = $("#publicSummary");
  const ranking = students()
    .map((student) => ({ student, publicScore: audienceApproval(student.id) }))
    .sort((a, b) => b.publicScore.percent - a.publicScore.percent || b.publicScore.count - a.publicScore.count);

  if (!ranking.length) {
    target.textContent = "Aprovacao do publico: sem votos ainda.";
    return;
  }

  target.innerHTML = "";
  const title = document.createElement("strong");
  title.textContent = "Aprovacao do publico";
  target.append(title);

  ranking.forEach(({ student, publicScore }) => {
    const line = document.createElement("span");
    line.textContent = `${student.name}: ${publicScore.label} (${publicScore.count} voto${publicScore.count === 1 ? "" : "s"})`;
    target.append(line);
  });
}

function renderStage() {
  if (!app.room) return;
  if (scoreboardRevealKey && app.room.status !== "finished") stopScoreboardReveal();

  const performer = currentStudent();
  $("#currentCode").textContent = app.room.code;
  $("#inviteCode").textContent = app.room.code;
  $("#stageTitle").textContent = app.room.status === "finished" ? "ENCERRADO" : "PALCO";
  $("#performerName").textContent = (performer && performer.name) || "Aguardando aluno";
  $("#performerPhoto").src = performer ? avatarFor(performer) : defaultAvatar("student");
  $("#teacherCurrentStudent").textContent = performer ? `Apresentando: ${performer.name}` : "Apresentando: aguardando aluno";

  const live = app.room.status !== "finished";
  $("#teacherPanel").classList.toggle("is-active", app.profile.role === "teacher" && live);
  $("#studentPanel").classList.toggle("is-active", app.profile.role === "student" && live);
  $("#viewerPanel").classList.toggle("is-active", app.profile.role === "viewer" && live);
  $("#finishRoom").classList.toggle("is-active", isRoomOwner() && live);
  $("#inviteBox").classList.toggle("is-active", app.profile.role === "teacher" && live);
  if (app.profile.role === "teacher" && live) renderQrCode(app.room.code);

  const isInQueue = app.room.queue.includes(app.profile.id);
  const isCurrent = performer && performer.id === app.profile.id;
  $("#joinQueue").disabled = isInQueue;
  $("#joinQueue").textContent = isInQueue ? "NA FILA" : "ENTRAR NA FILA";
  $("#studentMessage").textContent = isCurrent
    ? "Sua vez de apresentar. Boa apresentacao!"
    : isInQueue
      ? "Voce esta na fila. Aguarde sua chamada."
      : "Entre na fila e aguarde sua vez.";

  const alreadyScored = performer ? teacherScoredStudent(performer.id) : false;
  const voteStatus = performer ? teacherVoteStatus(performer.id) : { votedCount: 0, total: 0, complete: false };
  const nextStatus = performer ? teacherNextStatus(performer.id) : { confirmedCount: 0, total: 0, complete: false };
  const alreadyConfirmedNext = performer ? teacherConfirmedNext(performer.id) : false;
  const lastStudentOnStage = Boolean(performer) && isLastStudent();
  $("#sendScore").disabled = !performer || performer.id === app.profile.id || alreadyScored;
  $("#sendScore").textContent = alreadyScored ? "NOTA ENVIADA" : "DAR NOTA";
  $("#nextStudent").disabled = !performer || !voteStatus.complete || alreadyConfirmedNext;
  $("#nextStudent").title = !voteStatus.complete
    ? `Aguardando notas dos professores: ${voteStatus.votedCount}/${voteStatus.total}`
    : alreadyConfirmedNext
      ? `Aguardando confirmacao dos professores: ${nextStatus.confirmedCount}/${nextStatus.total}`
      : "";
  $("#nextStudent").textContent = alreadyConfirmedNext
    ? `AGUARDANDO ${nextStatus.confirmedCount}/${nextStatus.total}`
    : lastStudentOnStage
      ? "FINALIZAR"
      : "PROXIMO";
  $("#nextStudent").classList.toggle("blue-button", !lastStudentOnStage);
  $("#nextStudent").classList.toggle("danger-button", lastStudentOnStage);

  renderAudienceVote(performer, live);

  renderQueue();
  renderTeachers();
  renderGuests();
  renderScores();
}

function renderAudienceVote(performer, live) {
  const canVote = app.profile.role === "viewer" && live && performer;
  const alreadyVoted = performer ? viewerVotedStudent(performer.id) : false;
  $("#viewerMessage").textContent = canVote
    ? alreadyVoted
      ? "Seu voto para esta apresentacao ja foi registrado."
      : "Como publico, vote na apresentacao atual."
    : "Convidados acompanhando o show ao vivo.";

  $$("[data-public-vote]").forEach((button) => {
    button.disabled = !canVote || alreadyVoted;
  });
}

function renderQrCode(code) {
  const canvas = $("#qrCanvas");
  const ctx = canvas.getContext("2d");
  const inviteUrl = `${location.href.split("?")[0]}?room=${encodeURIComponent(code)}`;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  };
  image.onerror = () => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#082d76";
    ctx.font = "700 18px Arial";
    ctx.textAlign = "center";
    ctx.fillText(code, canvas.width / 2, canvas.height / 2);
  };
  image.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(inviteUrl)}`;
}

function render() {
  if (!app.room) return;
  syncParticipantJoinSounds(app.room);
  if (app.room.status === "finished") {
    renderScoreboard();
  } else {
    renderStage();
  }
}

function resizeProfilePhoto(file, maxSize = 320) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        if (image.width < 80 || image.height < 80) {
          reject(new Error("Imagem pequena demais"));
          return;
        }

        const sourceSize = Math.min(image.width, image.height);
        const sourceX = Math.round((image.width - sourceSize) / 2);
        const sourceY = Math.round((image.height - sourceSize) / 2);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = maxSize;
        canvas.height = maxSize;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, maxSize, maxSize);
        ctx.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, maxSize, maxSize);
        if (imageLooksUnsafe(ctx, maxSize)) {
          reject(new Error("Imagem bloqueada"));
          return;
        }
        resolve(canvas.toDataURL("image/jpeg", 0.84));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

$$("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.go));
});

$("#photoInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    if (hasBlockedImageName(file)) {
      throw new Error("Nome de arquivo bloqueado");
    }

    const photo = await resizeProfilePhoto(file);
    app.profile.photo = photo;
    saveProfile();
    $("#profilePhoto").src = photo;
    updateHeader();
  } catch {
    event.target.value = "";
    showNotice("Nao foi possivel carregar esta foto. Tente outra imagem.", "Foto invalida", "warning");
  }
});

$$("[data-role]").forEach((button) => {
  button.addEventListener("click", () => {
    app.profile.role = button.dataset.role;
    saveProfile();
    syncRoleButtons();
    updateHeader();
  });
});

$("#openRooms").addEventListener("click", () => {
  if (!profileReady()) return;
  showScreen("room");
});

$("#roomInput").addEventListener("input", (event) => {
  event.target.value = normalizeCode(event.target.value);
  app.selectedRoom = event.target.value;
  $("#selectedRoomLabel").textContent = event.target.value || "---";
  renderRooms();
});

$("#createRoom").addEventListener("click", async () => {
  if (app.profile.role !== "teacher") {
    showNotice("Somente professores podem criar sala.", "Acesso de professor", "warning");
    return;
  }
  const code = await createUniqueRoomCode();
  $("#roomInput").value = code;
  $("#selectedRoomLabel").textContent = code;
  await joinRoom(code, true);
});

$("#joinRoom").addEventListener("click", async () => {
  await joinRoom($("#roomInput").value || app.selectedRoom, false);
});

$("#leaveRoom").addEventListener("click", leaveCurrentRoom);
$("#leaveFinishedRoom").addEventListener("click", leaveCurrentRoom);

$("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!app.room || !app.room.code) return;

  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;

  if (hasBlockedText(text)) {
    input.value = "";
    showNotice("Mensagem bloqueada por conter palavra impropria.", "Chat protegido", "warning");
    return;
  }

  if (!profileReady()) return;
  const room = await loadRoom(app.room.code);
  if (!room) return;

  addChatMessage(room, text);
  input.value = "";
  await saveRoom(room);
  render();
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-participant]");
  if (!button) return;

  const room = await loadRoom(app.room.code);
  if (!room || !isRoomOwner(room)) {
    showNotice("Somente o professor que criou a sala pode remover participantes.", "Permissao negada", "warning");
    return;
  }

  const participantId = button.dataset.removeParticipant;
  const participant = room.participants && room.participants[participantId];
  if (!participant) return;

  const confirmed = await askConfirm(`Remover ${participant.name} da sala?`, "Remover participante");
  if (!confirmed) return;

  if (removeParticipantFromRoom(room, participantId)) {
    playRemoveSound();
    await saveRoom(room);
    render();
  }
});

$$("[data-public-vote]").forEach((button) => {
  button.addEventListener("click", async () => {
    const performer = currentStudent();
    if (!performer) return;

    const room = await loadRoom(app.room.code);
    if (!room) return;
    room.audienceVotes = room.audienceVotes || {};
    room.audienceVotes[performer.id] = room.audienceVotes[performer.id] || {};

    if (viewerVotedStudent(performer.id, app.profile.id, room)) {
      showNotice("Seu voto para este aluno ja foi registrado.", "Voto duplicado", "warning");
      app.room = room;
      render();
      return;
    }

    const vote = button.dataset.publicVote;
    if (!PUBLIC_VOTES[vote]) return;
    room.audienceVotes[performer.id][app.profile.id] = vote;
    addEvent(room, `${app.profile.name} votou ${PUBLIC_VOTES[vote].label} para ${performer.name}.`);
    playAudienceVoteSound(vote);
    await saveRoom(room);
    render();
  });
});

$("#copyCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(app.room.code);
  } catch {
    $("#roomInput").value = app.room.code;
    $("#roomInput").select();
    if (document.execCommand) document.execCommand("copy");
  }
  playActionSound();
  $("#copyCode").textContent = "copiado";
  setTimeout(() => ($("#copyCode").textContent = "copiar"), 900);
});

$$("[data-criterion]").forEach((input) => {
  input.addEventListener("input", () => {
    updateScoreTotal();
    playRangeSound();
  });
});

$("#sendScore").addEventListener("click", async () => {
  const performer = currentStudent();
  if (!performer) return;

  const room = await loadRoom(app.room.code);
  if (!room) return;
  room.scores[performer.id] = room.scores[performer.id] || {};
  if (teacherScoredStudent(performer.id, app.profile.id, room)) {
    showNotice("Voce ja deu nota para este aluno nesta rodada.", "Nota ja enviada", "warning");
    app.room = room;
    render();
    return;
  }

  const score = currentCriteriaScore();
  room.scores[performer.id][app.profile.id] = score;
  addEvent(room, `${app.profile.name} avaliou ${performer.name}: ${scoreTotal(score).toFixed(1)} pts.`);
  playActionSound();

  await saveRoom(room);
  render();
});

$("#nextStudent").addEventListener("click", async () => {
  const performer = currentStudent();
  if (!performer) return;

  const room = await loadRoom(app.room.code);
  if (!room) return;
  const livePerformer = currentStudent(room);
  if (!livePerformer) return;

  const voteStatus = teacherVoteStatus(livePerformer.id, room);
  if (!voteStatus.complete) {
    showNotice(`Aguardando notas dos professores: ${voteStatus.votedCount}/${voteStatus.total}`, "Ainda nao liberado", "warning");
    app.room = room;
    render();
    return;
  }

  room.nextVotes = room.nextVotes || {};
  room.nextVotes[livePerformer.id] = room.nextVotes[livePerformer.id] || {};
  room.nextVotes[livePerformer.id][app.profile.id] = true;

  const nextStatus = teacherNextStatus(livePerformer.id, room);
  if (nextStatus.complete) {
    playAdvanceSound();
    await advanceRoom(room);
  } else {
    playActionSound();
    addEvent(room, `${app.profile.name} confirmou proximo aluno (${nextStatus.confirmedCount}/${nextStatus.total}).`);
    await saveRoom(room);
  }

  render();
  if (app.room.status === "finished") showScreen("scoreboard");
});

$("#finishRoom").addEventListener("click", async () => {
  const room = await loadRoom(app.room.code);
  if (!room) return;
  if (!isRoomOwner(room)) {
    showNotice("Somente o professor que criou a sala pode finalizar o show.", "Permissao negada", "warning");
    return;
  }

  const confirmed = await askConfirm("Tem certeza que quer finalizar o show?", "Finalizar show");
  if (!confirmed) return;

  room.status = "finished";
  addEvent(room, "Professor finalizou o show.");
  playActionSound();
  await saveRoom(room);
  renderScoreboard();
  showScreen("scoreboard");
});

$("#joinQueue").addEventListener("click", async () => {
  const room = await loadRoom(app.room.code);
  if (!room) return;
  if (!room.queue.includes(app.profile.id)) {
    room.queue.push(app.profile.id);
    addEvent(room, `${app.profile.name} entrou na fila.`);
    playActionSound();
  }
  upsertParticipant(room);
  await saveRoom(room);
  render();
});

$("#newCompetition").addEventListener("click", async () => {
  if (app.room && app.room.code && isRoomOwner(app.room)) {
    await deleteRoom(app.room.code);
  }

  playActionSound();
  app.room = null;
  app.profile.roomCode = "";
  saveProfile();
  $("#roomInput").value = "";
  $("#selectedRoomLabel").textContent = "---";
  showScreen("room");
});

$("#restartCompetition").addEventListener("click", async () => {
  const room = await loadRoom(app.room.code);
  if (!room) return;
  if (!isRoomOwner(room)) {
    showNotice("Somente o professor que criou a sala pode recomeçar.", "Permissao negada", "warning");
    return;
  }

  resetRoomForNewRound(room);
  upsertParticipant(room);
  playActionSound();
  await saveRoom(room);
  renderStage();
  showScreen("stage");
});

app.channel.addEventListener("message", async (event) => {
  if (!app.room || event.data.code !== app.room.code) return;
  app.room = await loadRoom(app.room.code);
  if (!app.room) return;
  syncParticipantJoinSounds(app.room);
  render();
  showScreen(app.room.status === "finished" ? "scoreboard" : "stage");
});

async function startScanner() {
  if (!("BarcodeDetector" in window)) {
    $("#scannerStatus").textContent = "Este navegador nao suporta scanner de QR. Digite o codigo manualmente.";
    return;
  }

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = $("#qrVideo");
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    video.srcObject = scannerStream;
    await video.play();
    $("#scannerStatus").textContent = "Camera ligada. Procurando QR Code...";

    scannerTimer = window.setInterval(async () => {
      const codes = await detector.detect(video);
      if (!codes.length) return;

      const rawValue = codes[0].rawValue || "";
      const urlRoom = new URL(rawValue, location.href).searchParams.get("room");
      const detectedCode = normalizeCode(urlRoom || rawValue);
      if (!detectedCode) return;

      $("#roomInput").value = detectedCode;
      $("#selectedRoomLabel").textContent = detectedCode;
      app.selectedRoom = detectedCode;
      stopScanner();
      $("#scannerStatus").textContent = `Codigo ${detectedCode} encontrado. Entrando...`;
      playActionSound();
      await joinRoom(detectedCode, false);
    }, 700);
  } catch {
    $("#scannerStatus").textContent = "Nao foi possivel abrir a camera. Digite o codigo manualmente.";
  }
}

function stopScanner() {
  if (scannerTimer) {
    window.clearInterval(scannerTimer);
    scannerTimer = null;
  }

  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }

  const video = $("#qrVideo");
  if (video) video.srcObject = null;
}

$("#startScanner").addEventListener("click", startScanner);
$("#stopScanner").addEventListener("click", stopScanner);

function hydrateFromUrl() {
  const params = new URLSearchParams(location.search);
  const role = params.get("role");
  const room = normalizeCode(params.get("room") || "");

  if (["student", "teacher", "viewer"].includes(role)) {
    app.profile.role = role;
    saveProfile();
    syncRoleButtons();
  }

  if (room) {
    $("#roomInput").value = room;
    $("#selectedRoomLabel").textContent = room;
    app.selectedRoom = room;
  }

  return Boolean(room);
}

async function restoreSavedSession() {
  const savedCode = normalizeCode(app.profile.roomCode || "");
  if (!savedCode || app.room) return false;

  const room = await loadRoom(savedCode);
  if (!room) {
    app.profile.roomCode = "";
    saveProfile();
    showNotice("A sala anterior nao existe mais. Entre com um novo codigo.", "Sessao encerrada", "warning");
    return false;
  }

  const wasParticipant = Boolean(room.participants && room.participants[app.profile.id]);
  if (!wasParticipant && room.removedParticipantIds && room.removedParticipantIds.includes(app.profile.id)) {
    app.profile.roomCode = "";
    saveProfile();
    showNotice("Voce foi removido dessa sala pelo professor organizador.", "Participante removido", "danger");
    return false;
  }

  upsertParticipant(room);
  if (app.profile.role === "student" && !room.queue.includes(app.profile.id)) {
    room.queue.push(app.profile.id);
  }

  app.selectedRoom = savedCode;
  $("#roomInput").value = savedCode;
  $("#selectedRoomLabel").textContent = savedCode;
  await saveRoom(room, { activity: !wasParticipant });
  syncParticipantJoinSounds(app.room, false);
  render();
  showScreen(app.room.status === "finished" ? "scoreboard" : "stage");
  return true;
}

const shouldAutoJoinRoom = hydrateFromUrl();
updateHeader();
syncRoleButtons();
updateScoreTotal();
document.addEventListener("pointerdown", ensureAudio, { once: true });
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  playUiClickSound();
});
window.setInterval(syncActiveRoom, 2500);
window.setInterval(sendPresenceHeartbeat, 45000);

if (shouldAutoJoinRoom) {
  window.setTimeout(() => joinRoom(app.selectedRoom, false), 150);
} else {
  window.setTimeout(restoreSavedSession, 150);
}
