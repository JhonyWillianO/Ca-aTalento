import { getStore } from "@netlify/blobs";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

function cleanCode(value = "") {
  return String(value).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
}

function roomKey(code) {
  return `room-${cleanCode(code)}`;
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
  if (!existing) return incoming;

  const existingRound = existing.roundId || "legacy";
  const incomingRound = incoming.roundId || existingRound;
  const newRound = incomingRound !== existingRound;
  const status = incoming.status === "finished" || existing.status === "finished"
    ? incoming.status
    : existing.status;
  const restarting = newRound || (existing.status === "finished" && incoming.status === "live");
  const proposedIndex = restarting
    ? Number(incoming.currentIndex || 0)
    : status === "live"
      ? Math.max(Number(existing.currentIndex || 0), Number(incoming.currentIndex || 0))
      : Number(incoming.currentIndex || existing.currentIndex || 0);
  const removedParticipantIds = [
    ...new Set([...(existing.removedParticipantIds || []), ...(incoming.removedParticipantIds || [])])
  ];
  const participants = withoutRemovedParticipants(
    { ...(existing.participants || {}), ...(incoming.participants || {}) },
    removedParticipantIds
  );
  const queue = (incoming.queue || existing.queue || []).filter((id) => !removedParticipantIds.includes(id));
  const currentIndex = Math.min(Math.max(0, proposedIndex), Math.max(0, queue.length - 1));
  const scores = newRound ? (incoming.scores || {}) : mergeNested(existing.scores, incoming.scores);
  const audienceVotes = newRound ? (incoming.audienceVotes || {}) : mergeNested(existing.audienceVotes, incoming.audienceVotes);
  const nextVotes = newRound ? (incoming.nextVotes || {}) : mergeNested(existing.nextVotes, incoming.nextVotes);

  return {
    ...existing,
    ...incoming,
    status,
    roundId: incomingRound,
    currentIndex,
    removedParticipantIds,
    participants,
    queue,
    scores: withoutRemovedNested(scores, removedParticipantIds),
    audienceVotes: withoutRemovedNested(audienceVotes, removedParticipantIds),
    nextVotes: withoutRemovedNested(nextVotes, removedParticipantIds),
    events: newRound ? (incoming.events || []) : mergeEvents(existing.events, incoming.events)
  };
}

export default async (req, context) => {
  const store = getStore({ name: "caca-talentos-rooms", consistency: "strong" });
  const code = cleanCode(context.params?.code || "");

  if (req.method === "GET" && !code) {
    const { blobs } = await store.list({ prefix: "room-" });
    const rooms = [];

    for (const blob of blobs) {
      const room = await store.get(blob.key, { type: "json" });
      if (!room) continue;

      if (Object.keys(room.participants || {}).length === 0) {
        await store.delete(blob.key);
        continue;
      }

      rooms.push(room);
    }

    rooms.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return json({ rooms });
  }

  if (!code) return json({ error: "Codigo da sala obrigatorio." }, 400);

  if (req.method === "GET") {
    const room = await store.get(roomKey(code), { type: "json" });
    return room ? json({ room }) : json({ error: "Sala nao encontrada." }, 404);
  }

  if (req.method === "DELETE") {
    await store.delete(roomKey(code));
    return json({ ok: true });
  }

  if (req.method === "PUT" || req.method === "POST") {
    const room = await req.json();
    if (!room || cleanCode(room.code) !== code) {
      return json({ error: "Dados da sala invalidos." }, 400);
    }

    const existing = await store.get(roomKey(code), { type: "json" });
    const mergedRoom = mergeRoom(existing, room);
    mergedRoom.updatedAt = Date.now();
    await store.setJSON(roomKey(code), mergedRoom);
    return json({ room: mergedRoom });
  }

  return json({ error: "Metodo nao permitido." }, 405);
};

export const config = {
  path: ["/api/rooms", "/api/rooms/:code"]
};
