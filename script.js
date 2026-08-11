const savedProfile = JSON.parse(localStorage.getItem("talent-profile") || "{}");

const app = {
  profile: {
    id: savedProfile.id || crypto.randomUUID(),
    name: savedProfile.name || "",
    photo: savedProfile.photo || "",
    role: savedProfile.role || "student",
    roomCode: savedProfile.roomCode || ""
  },
  room: null,
  selectedRoom: "",
  channel: new BroadcastChannel("talent-room-sync")
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

let scannerStream = null;
let scannerTimer = null;
const USE_REMOTE_STORAGE = location.protocol.startsWith("http");

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
  return person?.photo || defaultAvatar(person?.role || "student");
}

function roomKey(code) {
  return `talent-room-${code}`;
}

function getLocalRoom(code) {
  const saved = localStorage.getItem(roomKey(code));
  return saved ? JSON.parse(saved) : null;
}

function localRooms() {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith("talent-room-"))
    .map((key) => JSON.parse(localStorage.getItem(key)))
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

async function saveRoom(room) {
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
      }
    } catch {
      // The local copy remains available if the network briefly fails.
    }
  }

  app.channel.postMessage({ code: room.code });
}

function createRoom(code) {
  return {
    code,
    status: "live",
    ownerId: app.profile.role === "teacher" ? app.profile.id : "",
    ownerName: app.profile.role === "teacher" ? app.profile.name : "",
    roundId: crypto.randomUUID(),
    currentIndex: 0,
    participants: {},
    removedParticipantIds: [],
    queue: [],
    scores: {},
    nextVotes: {},
    audienceVotes: {},
    events: [],
    createdAt: Date.now()
  };
}

function profileReady() {
  const typedName = $("#nameInput").value.trim();
  app.profile.name = typedName || randomName();
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
  $("#headerAvatar").src = avatarFor(app.profile);
  $("#profilePhoto").src = avatarFor(app.profile);
  $("#nameInput").value = app.profile.name || "";
}

function syncRoleButtons() {
  $$(".role-pill").forEach((item) => {
    item.classList.toggle("is-selected", item.dataset.role === app.profile.role);
  });
}

function addEvent(room, text) {
  room.events ||= [];
  room.events.unshift({ id: crypto.randomUUID(), type: "system", text, at: Date.now() });
  room.events = room.events.slice(0, 60);
}

function addChatMessage(room, text) {
  room.events ||= [];
  room.events.unshift({
    id: crypto.randomUUID(),
    type: "chat",
    text,
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
    name: app.profile.name,
    photo: app.profile.photo,
    role: app.profile.role,
    joinedAt: previous?.joinedAt || Date.now()
  };

  if (!previous) addEvent(room, `${app.profile.name} entrou como ${roleLabel(app.profile.role)}.`);
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
    alert("Digite ou escolha o codigo de uma sala.");
    return;
  }

  let room = await loadRoom(cleanCode);

  if (!room && shouldCreate) room = createRoom(cleanCode);

  if (!room) {
    alert("Sala nao encontrada. Confira o codigo ou crie uma nova sala.");
    return;
  }

  upsertParticipant(room);
  if (app.profile.role === "student" && !room.queue.includes(app.profile.id)) {
    room.queue.push(app.profile.id);
  }

  app.profile.roomCode = cleanCode;
  app.selectedRoom = cleanCode;
  saveProfile();
  await saveRoom(room);
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
  return Object.values(room?.participants || {}).filter((person) => person.role === "teacher");
}

function students(room = app.room) {
  return (room?.queue || []).map((id) => room.participants[id]).filter(Boolean);
}

function roomOwnerId(room = app.room) {
  if (room?.ownerId) return room.ownerId;
  const firstTeacher = teachers(room).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  return firstTeacher?.id || "";
}

function isRoomOwner(room = app.room) {
  return app.profile.role === "teacher" && roomOwnerId(room) === app.profile.id;
}

function resetRoomForNewRound(room) {
  room.status = "live";
  room.roundId = crypto.randomUUID();
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
  return Object.values(room?.scores?.[studentId] || {});
}

function scoreTotal(score) {
  if (typeof score === "number") return score * CRITERIA.length;
  return CRITERIA.reduce((sum, criterion) => sum + Number(score?.[criterion.key] || 0), 0);
}

function criterionAverage(studentId, criterionKey, room = app.room) {
  const values = studentScores(studentId, room);
  if (!values.length) return 0;

  const total = values.reduce((sum, score) => {
    if (typeof score === "number") return sum + Number(score);
    return sum + Number(score?.[criterionKey] || 0);
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
      for (let index = 0; index < CRITERIA.length; index += 1) {
        if (b.tieBreakers[index] !== a.tieBreakers[index]) {
          return b.tieBreakers[index] - a.tieBreakers[index];
        }
      }
      return a.name.localeCompare(b.name);
    });
}

function audienceVotesFor(studentId, room = app.room) {
  return Object.values(room?.audienceVotes?.[studentId] || {});
}

function audienceApproval(studentId, room = app.room) {
  const votes = audienceVotesFor(studentId, room);
  if (!votes.length) return { percent: 0, count: 0, label: "Sem votos do publico" };

  const total = votes.reduce((sum, vote) => sum + (PUBLIC_VOTES[vote]?.value || 0), 0);
  const percent = Math.round(total / votes.length);
  return { percent, count: votes.length, label: `${percent}% aprovacao do publico` };
}

function viewerVotedStudent(studentId, viewerId = app.profile.id, room = app.room) {
  return room?.audienceVotes?.[studentId]?.[viewerId] !== undefined;
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
  const votedCount = teacherList.filter((teacher) => room?.scores?.[studentId]?.[teacher.id] !== undefined).length;
  return { votedCount, total: teacherList.length, complete: teacherList.length > 0 && votedCount === teacherList.length };
}

function teacherScoredStudent(studentId, teacherId = app.profile.id, room = app.room) {
  return room?.scores?.[studentId]?.[teacherId] !== undefined;
}

function teacherNextStatus(studentId, room = app.room) {
  const teacherList = teachers(room);
  const confirmedCount = teacherList.filter((teacher) => room?.nextVotes?.[studentId]?.[teacher.id]).length;
  return {
    confirmedCount,
    total: teacherList.length,
    complete: teacherList.length > 0 && confirmedCount === teacherList.length
  };
}

function teacherConfirmedNext(studentId, teacherId = app.profile.id, room = app.room) {
  return Boolean(room?.nextVotes?.[studentId]?.[teacherId]);
}

function isLastStudent(room = app.room) {
  return !room || room.queue.length === 0 || room.currentIndex >= room.queue.length - 1;
}

function removeParticipantFromRoom(room, participantId) {
  const participant = room.participants?.[participantId];
  if (!participant || participantId === roomOwnerId(room)) return false;

  room.removedParticipantIds ||= [];
  if (!room.removedParticipantIds.includes(participantId)) {
    room.removedParticipantIds.push(participantId);
  }

  delete room.participants[participantId];
  room.queue = (room.queue || []).filter((id) => id !== participantId);
  if (room.currentIndex >= room.queue.length) {
    room.currentIndex = Math.max(0, room.queue.length - 1);
  }

  delete room.scores?.[participantId];
  delete room.audienceVotes?.[participantId];
  delete room.nextVotes?.[participantId];

  Object.values(room.scores || {}).forEach((scoreByTeacher) => delete scoreByTeacher[participantId]);
  Object.values(room.audienceVotes || {}).forEach((voteByViewer) => delete voteByViewer[participantId]);
  Object.values(room.nextVotes || {}).forEach((nextByTeacher) => delete nextByTeacher[participantId]);

  addEvent(room, `${participant.name} foi removido da sala pelo organizador.`);
  return true;
}

async function advanceRoom(room) {
  if (!room) return;
  if (room.currentIndex < room.queue.length - 1) {
    room.currentIndex += 1;
    const next = currentStudent(room);
    addEvent(room, `${next?.name || "Proximo aluno"} subiu ao palco.`);
  } else {
    room.status = "finished";
    addEvent(room, "Show finalizado. Placar liberado.");
  }
  await saveRoom(room);
}

async function syncActiveRoom() {
  if (!USE_REMOTE_STORAGE || !app.room?.code) return;

  const latest = await loadRoom(app.room.code);
  if (!latest) {
    app.room = null;
    app.profile.roomCode = "";
    saveProfile();
    alert("Esta sala foi fechada pelo organizador.");
    showScreen("room");
    return;
  }

  if (latest.participants && !latest.participants[app.profile.id]) {
    app.room = null;
    app.profile.roomCode = "";
    alert("Voce foi removido da sala pelo organizador.");
    showScreen("room");
    return;
  }

  const previousStatus = app.room.status;
  app.room = latest;
  render();

  if (latest.status !== previousStatus) {
    showScreen(latest.status === "finished" ? "scoreboard" : "stage");
  }
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
    const studentCount = room.queue?.length || 0;
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
    ? "Crie uma sala nova ou entre em uma sala existente com o mesmo codigo."
    : isViewer
      ? "Digite o codigo da sala ou use o scanner de QR Code."
      : "Aluno entra apenas com o codigo enviado pelo professor.";

  $("#createRoom").style.display = isTeacher ? "inline-block" : "none";
  $("#roomGrid").style.display = isTeacher ? "grid" : "none";
  $("#scannerBox").classList.toggle("is-active", isViewer);
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
    const gaveScore = performer && app.room.scores[performer.id]?.[teacher.id] !== undefined;
    list.append(personLine(teacher, gaveScore ? "nota enviada" : "aguardando nota", {
      removable: canRemoveParticipant(teacher)
    }));
  });
}

function renderGuests() {
  const list = $("#guestList");
  list.innerHTML = "";
  const guests = Object.values(app.room?.participants || {})
    .filter((person) => person.role === "viewer")
    .sort((a, b) => a.name.localeCompare(b.name));

  guests.forEach((guest) => {
    list.append(personLine(guest, "convidado", {
      removable: canRemoveParticipant(guest)
    }));
  });
}

function renderScores() {
  const list = $("#scoreList");
  list.innerHTML = "";
  const events = app.room?.events || [];

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

function renderScoreboard() {
  const podium = $("#podium");
  podium.innerHTML = "";

  const ranking = finalRanking();

  if (!ranking.length) {
    renderEmpty(podium);
  } else {
    ranking.forEach((student, index) => {
      const li = document.createElement("li");
      const medal = document.createElement("span");
      const image = document.createElement("img");
      const body = document.createElement("div");
      const name = document.createElement("strong");
      const meta = document.createElement("span");

      medal.className = "medal";
      medal.textContent = index + 1;
      image.src = avatarFor(student);
      image.alt = "";
      name.textContent = student.name;
      meta.className = "meta";
      const publicScore = audienceApproval(student.id);
      meta.textContent = `Nota final ${student.finalScore.toFixed(1)} / 40 - ${publicScore.label}`;

      body.append(name, meta);
      li.append(medal, image, body);
      podium.append(li);
    });
  }

  const owner = isRoomOwner();
  $("#finishActions").style.display = owner ? "grid" : "none";
  $("#waitingHost").textContent = "Aguardando o professor organizador iniciar outra rodada.";
  $("#waitingHost").classList.toggle("is-active", !owner);
  renderPublicSummary();
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

  const performer = currentStudent();
  $("#currentCode").textContent = app.room.code;
  $("#inviteCode").textContent = app.room.code;
  $("#stageTitle").textContent = app.room.status === "finished" ? "ENCERRADO" : "PALCO";
  $("#performerName").textContent = performer?.name || "Aguardando aluno";
  $("#performerPhoto").src = performer ? avatarFor(performer) : defaultAvatar("student");

  const live = app.room.status !== "finished";
  $("#teacherPanel").classList.toggle("is-active", app.profile.role === "teacher" && live);
  $("#studentPanel").classList.toggle("is-active", app.profile.role === "student" && live);
  $("#viewerPanel").classList.toggle("is-active", app.profile.role === "viewer" && live);
  $("#finishRoom").classList.toggle("is-active", isRoomOwner() && live);
  $("#inviteBox").classList.toggle("is-active", app.profile.role === "teacher" && live);
  if (app.profile.role === "teacher" && live) renderQrCode(app.room.code);

  const isInQueue = app.room.queue.includes(app.profile.id);
  const isCurrent = performer?.id === app.profile.id;
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
  const inviteUrl = `${location.href.split("?")[0]}?room=${encodeURIComponent(code)}&role=viewer`;
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
  if (app.room.status === "finished") {
    renderScoreboard();
  } else {
    renderStage();
  }
}

function resizeProfilePhoto(file, maxSize = 420) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
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
    const photo = await resizeProfilePhoto(file);
    app.profile.photo = photo;
    saveProfile();
    $("#profilePhoto").src = photo;
    updateHeader();
  } catch {
    alert("Nao foi possivel carregar esta foto. Tente outra imagem.");
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
  profileReady();
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
    alert("Somente professores podem criar sala.");
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

$("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!app.room?.code) return;

  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;

  profileReady();
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
    alert("Somente o professor que criou a sala pode remover participantes.");
    return;
  }

  const participantId = button.dataset.removeParticipant;
  const participant = room.participants?.[participantId];
  if (!participant) return;

  const confirmed = window.confirm(`Remover ${participant.name} da sala?`);
  if (!confirmed) return;

  if (removeParticipantFromRoom(room, participantId)) {
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
    room.audienceVotes ||= {};
    room.audienceVotes[performer.id] ||= {};

    if (viewerVotedStudent(performer.id, app.profile.id, room)) {
      alert("Seu voto para este aluno ja foi registrado.");
      app.room = room;
      render();
      return;
    }

    const vote = button.dataset.publicVote;
    room.audienceVotes[performer.id][app.profile.id] = vote;
    addEvent(room, `${app.profile.name} votou ${PUBLIC_VOTES[vote].label} para ${performer.name}.`);
    await saveRoom(room);
    render();
  });
});

$("#copyCode").addEventListener("click", async () => {
  await navigator.clipboard.writeText(app.room.code);
  $("#copyCode").textContent = "copiado";
  setTimeout(() => ($("#copyCode").textContent = "copiar"), 900);
});

$$("[data-criterion]").forEach((input) => {
  input.addEventListener("input", updateScoreTotal);
});

$("#sendScore").addEventListener("click", async () => {
  const performer = currentStudent();
  if (!performer) return;

  const room = await loadRoom(app.room.code);
  if (!room) return;
  room.scores[performer.id] ||= {};
  if (teacherScoredStudent(performer.id, app.profile.id, room)) {
    alert("Voce ja deu nota para este aluno nesta rodada.");
    app.room = room;
    render();
    return;
  }

  const score = currentCriteriaScore();
  room.scores[performer.id][app.profile.id] = score;
  addEvent(room, `${app.profile.name} avaliou ${performer.name}: ${scoreTotal(score).toFixed(1)} pts.`);

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
    alert(`Aguardando notas dos professores: ${voteStatus.votedCount}/${voteStatus.total}`);
    app.room = room;
    render();
    return;
  }

  room.nextVotes ||= {};
  room.nextVotes[livePerformer.id] ||= {};
  room.nextVotes[livePerformer.id][app.profile.id] = true;

  const nextStatus = teacherNextStatus(livePerformer.id, room);
  if (nextStatus.complete) {
    await advanceRoom(room);
  } else {
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
    alert("Somente o professor que criou a sala pode finalizar o show.");
    return;
  }

  const confirmed = window.confirm("Tem certeza que quer finalizar o show?");
  if (!confirmed) return;

  room.status = "finished";
  addEvent(room, "Professor finalizou o show.");
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
  }
  upsertParticipant(room);
  await saveRoom(room);
  render();
});

$("#newCompetition").addEventListener("click", async () => {
  if (app.room?.code && isRoomOwner(app.room)) {
    await deleteRoom(app.room.code);
  }

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
    alert("Somente o professor que criou a sala pode recomeçar.");
    return;
  }

  resetRoomForNewRound(room);
  upsertParticipant(room);
  await saveRoom(room);
  renderStage();
  showScreen("stage");
});

app.channel.addEventListener("message", async (event) => {
  if (!app.room || event.data.code !== app.room.code) return;
  app.room = await loadRoom(app.room.code);
  if (!app.room) return;
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
      $("#scannerStatus").textContent = `Codigo ${detectedCode} encontrado. Clique em ENTRAR.`;
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
}

hydrateFromUrl();
updateHeader();
syncRoleButtons();
updateScoreTotal();
window.setInterval(syncActiveRoom, 2500);
