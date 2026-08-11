const app = {
  profile: {
    id: crypto.randomUUID(),
    name: "",
    photo: "",
    role: "student",
    roomCode: ""
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

function defaultAvatar(role) {
  const label = role === "teacher" ? "P" : role === "viewer" ? "C" : "A";
  const primary = role === "teacher" ? "#12844f" : role === "viewer" ? "#7b5eea" : "#0b78f0";
  const hair = role === "teacher" ? "#402615" : "#2d221e";
  const accessory = role === "teacher"
    ? '<rect x="34" y="47" width="52" height="16" rx="8" fill="none" stroke="#10254d" stroke-width="5"/>'
    : "";

  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <rect width="160" height="160" rx="80" fill="${primary}"/>
      <circle cx="80" cy="74" r="44" fill="#ffd798"/>
      <path d="M38 63c7-33 66-46 88-10-23-8-48-4-72 12z" fill="${hair}"/>
      ${accessory}
      <circle cx="64" cy="79" r="6" fill="#10254d"/>
      <circle cx="96" cy="79" r="6" fill="#10254d"/>
      <path d="M61 99c12 12 27 12 39 0" fill="none" stroke="#10254d" stroke-width="6" stroke-linecap="round"/>
      <path d="M28 150c7-34 97-34 104 0z" fill="#ffc928"/>
      <circle cx="123" cy="123" r="24" fill="#ffffff"/>
      <text x="123" y="133" text-anchor="middle" font-size="28" font-family="Arial" font-weight="700" fill="${primary}">${label}</text>
    </svg>
  `)}`;
}

function avatarFor(person) {
  return person?.photo || defaultAvatar(person?.role || "student");
}

function roomKey(code) {
  return `talent-room-${code}`;
}

function getRoom(code) {
  const saved = localStorage.getItem(roomKey(code));
  return saved ? JSON.parse(saved) : null;
}

function allRooms() {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith("talent-room-"))
    .map((key) => JSON.parse(localStorage.getItem(key)))
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function saveRoom(room) {
  localStorage.setItem(roomKey(room.code), JSON.stringify(room));
  app.channel.postMessage({ code: room.code });
  app.room = room;
}

function createRoom(code) {
  return {
    code,
    status: "live",
    currentIndex: 0,
    participants: {},
    queue: [],
    scores: {},
    audienceVotes: {},
    events: [],
    createdAt: Date.now()
  };
}

function createTestRoom() {
  const now = Date.now();
  const room = createRoom("TESTE1");
  room.createdAt = now;
  room.participants = {
    demoTeacher1: {
      id: "demoTeacher1",
      name: "Prof. Jony",
      photo: "",
      role: "teacher",
      joinedAt: now - 7000
    },
    demoTeacher2: {
      id: "demoTeacher2",
      name: "Prof. Ana",
      photo: "",
      role: "teacher",
      joinedAt: now - 6000
    },
    demoStudent1: {
      id: "demoStudent1",
      name: "Livia",
      photo: "",
      role: "student",
      joinedAt: now - 5000
    },
    demoStudent2: {
      id: "demoStudent2",
      name: "Rafael",
      photo: "",
      role: "student",
      joinedAt: now - 4000
    },
    demoStudent3: {
      id: "demoStudent3",
      name: "Yasmin",
      photo: "",
      role: "student",
      joinedAt: now - 3000
    },
    demoViewer1: {
      id: "demoViewer1",
      name: "Familia da Livia",
      photo: "",
      role: "viewer",
      joinedAt: now - 2000
    }
  };
  room.queue = ["demoStudent1", "demoStudent2", "demoStudent3"];
  room.scores = {
    demoStudent1: {
      demoTeacher1: {
        technique: 9,
        expression: 8.5,
        stagePresence: 9,
        creativity: 8
      },
      demoTeacher2: {
        technique: 8.5,
        expression: 9,
        stagePresence: 8.5,
        creativity: 9
      }
    }
  };
  room.audienceVotes = {
    demoStudent1: {
      demoViewer1: "great"
    },
    demoStudent2: {
      demoViewer1: "good"
    }
  };
  room.currentIndex = 1;
  room.events = [
    { id: crypto.randomUUID(), text: "Livia recebeu media 8.8.", at: now - 1200 },
    { id: crypto.randomUUID(), text: "Rafael subiu ao palco.", at: now - 900 },
    { id: crypto.randomUUID(), text: "Familia da Livia entrou para acompanhar.", at: now - 500 }
  ];
  saveRoom(room);
  return room;
}

function profileReady() {
  const typedName = $("#nameInput").value.trim();
  app.profile.name = typedName || randomName();
  $("#nameInput").value = app.profile.name;
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
}

function addEvent(room, text) {
  room.events ||= [];
  room.events.unshift({ id: crypto.randomUUID(), text, at: Date.now() });
  room.events = room.events.slice(0, 20);
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
  return "aluno";
}

function joinRoom(code, shouldCreate = false) {
  if (!profileReady()) return;

  const cleanCode = shouldCreate ? normalizeCode(code || makeCode()) : normalizeCode(code);
  if (!cleanCode) {
    alert("Digite ou escolha o codigo de uma sala.");
    return;
  }

  let room = getRoom(cleanCode);

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
  saveRoom(room);
  render();
  showScreen(room.status === "finished" ? "scoreboard" : "stage");
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

function resetRoomForNewRound(room) {
  room.status = "live";
  room.currentIndex = 0;
  room.scores = {};
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

function allTeachersScored(studentId, room = app.room) {
  const teacherIds = teachers(room).map((teacher) => teacher.id);
  if (!teacherIds.length) return false;
  return teacherIds.every((id) => room.scores[studentId]?.[id] !== undefined);
}

function teacherScoredStudent(studentId, teacherId = app.profile.id, room = app.room) {
  return room?.scores?.[studentId]?.[teacherId] !== undefined;
}

function isLastStudent(room = app.room) {
  return !room || room.queue.length === 0 || room.currentIndex >= room.queue.length - 1;
}

function advanceRoom(room) {
  if (room.currentIndex < room.queue.length - 1) {
    room.currentIndex += 1;
    const next = currentStudent(room);
    addEvent(room, `${next?.name || "Proximo aluno"} subiu ao palco.`);
  } else {
    room.status = "finished";
    addEvent(room, "Show finalizado. Placar liberado.");
  }
  saveRoom(room);
}

function renderEmpty(target) {
  target.append($("#emptyItem").content.cloneNode(true));
}

function personLine(person, metaText) {
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
  return li;
}

function renderRooms() {
  const grid = $("#roomGrid");
  const filter = normalizeCode($("#roomInput").value);
  const rooms = allRooms().filter((room) => !filter || room.code.includes(filter));
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
    list.append(personLine(student, `${points}/40 pts - ${state} - ${publicScore.label}`));
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
    list.append(personLine(teacher, gaveScore ? "nota enviada" : "aguardando nota"));
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
    li.textContent = event.text;
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

  const isTeacher = app.profile.role === "teacher";
  $("#finishActions").style.display = isTeacher ? "grid" : "none";
  $("#waitingHost").classList.toggle("is-active", !isTeacher);
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
  $("#finishRoom").style.display = app.profile.role === "teacher" && live ? "grid" : "none";
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
  const lastStudentOnStage = Boolean(performer) && isLastStudent();
  $("#sendScore").disabled = !performer || performer.id === app.profile.id || alreadyScored;
  $("#sendScore").textContent = alreadyScored ? "NOTA ENVIADA" : "DAR NOTA";
  $("#nextStudent").disabled = !performer;
  $("#nextStudent").textContent = lastStudentOnStage ? "FINALIZAR" : "PROXIMO";
  $("#nextStudent").classList.toggle("blue-button", !lastStudentOnStage);
  $("#nextStudent").classList.toggle("danger-button", lastStudentOnStage);

  renderAudienceVote(performer, live);

  renderQueue();
  renderTeachers();
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

$$("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.go));
});

$("#photoInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    app.profile.photo = reader.result;
    $("#profilePhoto").src = reader.result;
    updateHeader();
  };
  reader.readAsDataURL(file);
});

$$("[data-role]").forEach((button) => {
  button.addEventListener("click", () => {
    app.profile.role = button.dataset.role;
    $$(".role-pill").forEach((item) => item.classList.remove("is-selected"));
    button.classList.add("is-selected");
    updateHeader();
  });
});

$("#openRooms").addEventListener("click", () => {
  profileReady();
  showScreen("room");
});

function enterTestRoom() {
  if (!profileReady()) return;
  app.profile.role = app.profile.role || "teacher";
  const room = createTestRoom();
  upsertParticipant(room);

  if (app.profile.role === "student" && !room.queue.includes(app.profile.id)) {
    room.queue.push(app.profile.id);
  }

  app.profile.roomCode = room.code;
  app.selectedRoom = room.code;
  $("#roomInput").value = room.code;
  $("#selectedRoomLabel").textContent = room.code;
  saveRoom(room);
  renderStage();
  showScreen("stage");
}

$("#testRoom").addEventListener("click", enterTestRoom);
$("#testRoomFromList").addEventListener("click", enterTestRoom);

$("#roomInput").addEventListener("input", (event) => {
  event.target.value = normalizeCode(event.target.value);
  app.selectedRoom = event.target.value;
  $("#selectedRoomLabel").textContent = event.target.value || "---";
  renderRooms();
});

$("#createRoom").addEventListener("click", () => {
  if (app.profile.role !== "teacher") {
    alert("Somente professores podem criar sala.");
    return;
  }
  const code = normalizeCode($("#roomInput").value) || makeCode();
  joinRoom(code, true);
});

$("#joinRoom").addEventListener("click", () => {
  joinRoom($("#roomInput").value || app.selectedRoom, false);
});

$$("[data-public-vote]").forEach((button) => {
  button.addEventListener("click", () => {
    const performer = currentStudent();
    if (!performer) return;

    const room = getRoom(app.room.code);
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
    saveRoom(room);
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

$("#sendScore").addEventListener("click", () => {
  const performer = currentStudent();
  if (!performer) return;

  const room = getRoom(app.room.code);
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

  saveRoom(room);
  render();
});

$("#nextStudent").addEventListener("click", () => {
  const room = getRoom(app.room.code);
  advanceRoom(room);
  render();
  if (app.room.status === "finished") showScreen("scoreboard");
});

$("#finishRoom").addEventListener("click", () => {
  const room = getRoom(app.room.code);
  room.status = "finished";
  addEvent(room, "Professor finalizou o show.");
  saveRoom(room);
  renderScoreboard();
  showScreen("scoreboard");
});

$("#joinQueue").addEventListener("click", () => {
  const room = getRoom(app.room.code);
  if (!room.queue.includes(app.profile.id)) {
    room.queue.push(app.profile.id);
    addEvent(room, `${app.profile.name} entrou na fila.`);
  }
  upsertParticipant(room);
  saveRoom(room);
  render();
});

$("#newCompetition").addEventListener("click", () => {
  app.room = null;
  app.profile.roomCode = "";
  $("#roomInput").value = "";
  $("#selectedRoomLabel").textContent = "---";
  showScreen("room");
});

$("#restartCompetition").addEventListener("click", () => {
  const room = getRoom(app.room.code);
  resetRoomForNewRound(room);
  upsertParticipant(room);
  saveRoom(room);
  renderStage();
  showScreen("stage");
});

app.channel.addEventListener("message", (event) => {
  if (!app.room || event.data.code !== app.room.code) return;
  app.room = getRoom(app.room.code);
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
    $$(".role-pill").forEach((item) => item.classList.toggle("is-selected", item.dataset.role === role));
  }

  if (room) {
    $("#roomInput").value = room;
    $("#selectedRoomLabel").textContent = room;
    app.selectedRoom = room;
  }
}

hydrateFromUrl();
updateHeader();
updateScoreTotal();
