import { getStore } from "@netlify/blobs";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

const MAX_BODY_BYTES = 900000;
const MAX_EVENTS = 80;
const MAX_PARTICIPANTS = 220;
const ROOM_IDLE_MS = 60 * 60 * 1000;
const PARTICIPANT_STALE_MS = 60 * 60 * 1000;
const VALID_ROLES = new Set(["student", "teacher", "viewer"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

function cleanCode(value = "") {
  return String(value).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
}

function cleanId(value = "") {
  return String(value).replace(/[^a-z0-9-]/gi, "").slice(0, 80);
}

function cleanText(value = "", maxLength = 120) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function roomKey(code) {
  return `room-${cleanCode(code)}`;
}

function sanitizeParticipant(person = {}, fallbackId = "") {
  const id = cleanId(person.id || fallbackId);
  if (!id) return null;

  return {
    id,
    name: cleanText(person.name || "Visitante", 32),
    photo: String(person.photo || "").length <= 260000 ? String(person.photo || "") : "",
    role: VALID_ROLES.has(person.role) ? person.role : "student",
    joinedAt: Number(person.joinedAt || Date.now()),
    lastSeenAt: Number(person.lastSeenAt || person.joinedAt || Date.now())
  };
}

function sanitizeParticipants(participants = {}) {
  const cleaned = {};

  for (const [key, person] of Object.entries(participants || {}).slice(0, MAX_PARTICIPANTS)) {
    const participant = sanitizeParticipant(person, key);
    if (participant) cleaned[participant.id] = participant;
  }

  return cleaned;
}

function sanitizeEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .slice(0, MAX_EVENTS)
    .map((event) => {
      if (typeof event === "string") {
        return { id: cleanId(`${Date.now()}-${event}`), type: "system", text: cleanText(event, 180), at: Date.now() };
      }

      const type = event?.type === "chat" ? "chat" : "system";
      return {
        id: cleanId(event?.id || crypto.randomUUID()),
        type,
        text: cleanText(event?.text, 180),
        author: cleanText(event?.author, 32),
        role: VALID_ROLES.has(event?.role) ? event.role : "",
        roleLabel: cleanText(event?.roleLabel, 24),
        at: Number(event?.at || Date.now())
      };
    })
    .filter((event) => event.text);
}

function sanitizeNested(values = {}) {
  const cleaned = {};

  for (const [outerKey, innerValue] of Object.entries(values || {})) {
    const outerId = cleanId(outerKey);
    if (!outerId) continue;

    if (innerValue && typeof innerValue === "object" && !Array.isArray(innerValue)) {
      cleaned[outerId] = {};
      for (const [innerKey, value] of Object.entries(innerValue)) {
        const innerId = cleanId(innerKey);
        if (!innerId) continue;
        cleaned[outerId][innerId] = value;
      }
    }
  }

  return cleaned;
}

function sanitizeRoom(room = {}) {
  const participants = sanitizeParticipants(room.participants);
  const participantIds = new Set(Object.keys(participants));
  const queue = (Array.isArray(room.queue) ? room.queue : [])
    .map(cleanId)
    .filter((id, index, ids) => id && participantIds.has(id) && ids.indexOf(id) === index);

  return {
    code: cleanCode(room.code),
    status: room.status === "finished" ? "finished" : "live",
    ownerId: cleanId(room.ownerId),
    ownerName: cleanText(room.ownerName, 32),
    roundId: cleanId(room.roundId || crypto.randomUUID()),
    roundStartedAt: Number(room.roundStartedAt || Date.now()),
    currentIndex: Number(room.currentIndex || 0),
    participants,
    removedParticipantIds: (Array.isArray(room.removedParticipantIds) ? room.removedParticipantIds : []).map(cleanId).filter(Boolean),
    queue,
    scores: sanitizeNested(room.scores),
    nextVotes: sanitizeNested(room.nextVotes),
    audienceVotes: sanitizeNested(room.audienceVotes),
    events: sanitizeEvents(room.events),
    createdAt: Number(room.createdAt || Date.now()),
    updatedAt: Number(room.updatedAt || room.createdAt || Date.now())
  };
}

function pruneStaleParticipants(room, now = Date.now()) {
  const participants = {};

  for (const [id, person] of Object.entries(room.participants || {})) {
    if (now - Number(person.lastSeenAt || person.joinedAt || 0) <= PARTICIPANT_STALE_MS) {
      participants[id] = person;
    }
  }

  const participantIds = new Set(Object.keys(participants));
  return {
    ...room,
    participants,
    queue: (room.queue || []).filter((id) => participantIds.has(id))
  };
}

function roomShouldBeDeleted(room, now = Date.now()) {
  const cleaned = pruneStaleParticipants(sanitizeRoom(room), now);
  const hasTeacher = Object.values(cleaned.participants || {}).some((person) => person.role === "teacher");
  const idleFor = now - Number(cleaned.updatedAt || cleaned.createdAt || 0);
  return !hasTeacher || idleFor >= ROOM_IDLE_MS;
}

function mergeNested(existing = {}, incoming = {}) {
  const merged = { ...existing };

  for (const [outerKey, innerValue] of Object.entries(incoming || {})) {
    if (innerValue && typeof innerValue === "object" && !Array.isArray(innerValue)) {
      merged[outerKey] = { ...(merged[outerKey] || {}), ...innerValue };
    } else {
      merged[outerKey] = innerValue;
    }
  }

  return merged;
}

function mergeEvents(existing = [], incoming = []) {
  const byId = new Map();

  [...existing, ...incoming].forEach((event) => {
    if (!event) return;
    const id = event.id || `${event.at || Date.now()}-${event.text || ""}`;
    byId.set(id, { ...event, id });
  });

  return [...byId.values()]
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
    .slice(0, 80);
}

function withoutRemovedParticipants(participants = {}, removedIds = []) {
  const cleaned = { ...participants };
  removedIds.forEach((id) => delete cleaned[id]);
  return cleaned;
}

function withoutRemovedNested(values = {}, removedIds = []) {
  const cleaned = {};

  for (const [outerKey, innerValue] of Object.entries(values || {})) {
    if (removedIds.includes(outerKey)) continue;

    if (innerValue && typeof innerValue === "object" && !Array.isArray(innerValue)) {
      cleaned[outerKey] = { ...innerValue };
      removedIds.forEach((id) => delete cleaned[outerKey][id]);
    } else {
      cleaned[outerKey] = innerValue;
    }
  }

  return cleaned;
}

function mergeRoom(existing, incoming) {
  const safeIncoming = sanitizeRoom(incoming);
  if (!existing) return safeIncoming;

  const safeExisting = sanitizeRoom(existing);

  const existingStartedAt = Number(safeExisting.roundStartedAt || safeExisting.createdAt || 0);
  const incomingStartedAt = Number(safeIncoming.roundStartedAt || safeIncoming.createdAt || existingStartedAt);
  if (incomingStartedAt < existingStartedAt) {
    return safeExisting;
  }

  const existingRound = safeExisting.roundId || "legacy";
  const incomingRound = safeIncoming.roundId || existingRound;
  const newRound = incomingRound !== existingRound || incomingStartedAt > existingStartedAt;
  const status = safeIncoming.status === "finished" || safeExisting.status === "finished"
    ? safeIncoming.status
    : safeExisting.status;
  const restarting = newRound || (safeExisting.status === "finished" && safeIncoming.status === "live");
  const proposedIndex = restarting
    ? Number(safeIncoming.currentIndex || 0)
    : status === "live"
      ? Math.max(Number(safeExisting.currentIndex || 0), Number(safeIncoming.currentIndex || 0))
      : Number(safeIncoming.currentIndex || safeExisting.currentIndex || 0);
  const removedParticipantIds = [
    ...new Set([...(safeExisting.removedParticipantIds || []), ...(safeIncoming.removedParticipantIds || [])])
  ];
  const participants = withoutRemovedParticipants(
    { ...(safeExisting.participants || {}), ...(safeIncoming.participants || {}) },
    removedParticipantIds
  );
  const queue = (safeIncoming.queue || safeExisting.queue || []).filter((id) => !removedParticipantIds.includes(id));
  const currentIndex = Math.min(Math.max(0, proposedIndex), Math.max(0, queue.length - 1));
  const scores = newRound ? (safeIncoming.scores || {}) : mergeNested(safeExisting.scores, safeIncoming.scores);
  const audienceVotes = newRound ? (safeIncoming.audienceVotes || {}) : mergeNested(safeExisting.audienceVotes, safeIncoming.audienceVotes);
  const nextVotes = newRound ? (safeIncoming.nextVotes || {}) : mergeNested(safeExisting.nextVotes, safeIncoming.nextVotes);

  return {
    ...safeExisting,
    ...safeIncoming,
    status,
    ownerId: safeExisting.ownerId || safeIncoming.ownerId,
    ownerName: safeExisting.ownerName || safeIncoming.ownerName,
    roundId: incomingRound,
    roundStartedAt: newRound ? incomingStartedAt : existingStartedAt,
    currentIndex,
    removedParticipantIds,
    participants,
    queue,
    scores: withoutRemovedNested(scores, removedParticipantIds),
    audienceVotes: withoutRemovedNested(audienceVotes, removedParticipantIds),
    nextVotes: withoutRemovedNested(nextVotes, removedParticipantIds),
    events: newRound ? (safeIncoming.events || []) : mergeEvents(safeExisting.events, safeIncoming.events)
  };
}

export default async (req, context) => {
  const store = getStore({ name: "caca-talentos-rooms", consistency: "strong" });
  const code = cleanCode(context.params?.code || "");
  const now = Date.now();

  if (req.method === "GET" && !code) {
    const { blobs } = await store.list({ prefix: "room-" });
    const rooms = [];

    for (const blob of blobs) {
      const room = await store.get(blob.key, { type: "json" });
      if (!room) continue;

      if (roomShouldBeDeleted(room, now)) {
        await store.delete(blob.key);
        continue;
      }

      rooms.push(pruneStaleParticipants(sanitizeRoom(room), now));
    }

    rooms.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return json({ rooms });
  }

  if (!code) return json({ error: "Codigo da sala obrigatorio." }, 400);

  if (req.method === "GET") {
    const room = await store.get(roomKey(code), { type: "json" });
    if (!room) return json({ error: "Sala nao encontrada." }, 404);
    if (roomShouldBeDeleted(room, now)) {
      await store.delete(roomKey(code));
      return json({ error: "Sala expirada." }, 404);
    }
    return json({ room: pruneStaleParticipants(sanitizeRoom(room), now) });
  }

  if (req.method === "DELETE") {
    await store.delete(roomKey(code));
    return json({ ok: true });
  }

  if (req.method === "PUT" || req.method === "POST") {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: "Envio muito grande. Reduza a foto ou tente novamente." }, 413);
    }

    let room;
    try {
      room = await req.json();
    } catch {
      return json({ error: "JSON invalido." }, 400);
    }

    if (!room || cleanCode(room.code) !== code) {
      return json({ error: "Dados da sala invalidos." }, 400);
    }

    const existing = await store.get(roomKey(code), { type: "json" });
    const mergedRoom = mergeRoom(existing, room);
    mergedRoom.updatedAt = now;
    await store.setJSON(roomKey(code), mergedRoom);
    return json({ room: mergedRoom });
  }

  return json({ error: "Metodo nao permitido." }, 405);
};

export const config = {
  path: ["/api/rooms", "/api/rooms/:code"]
};
