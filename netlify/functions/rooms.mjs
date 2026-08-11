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

export default async (req, context) => {
  const store = getStore({ name: "caca-talentos-rooms", consistency: "strong" });
  const code = cleanCode(context.params?.code || "");

  if (req.method === "GET" && !code) {
    const { blobs } = await store.list({ prefix: "room-" });
    const rooms = [];

    for (const blob of blobs) {
      const room = await store.get(blob.key, { type: "json" });
      if (room) rooms.push(room);
    }

    rooms.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return json({ rooms });
  }

  if (!code) return json({ error: "Codigo da sala obrigatorio." }, 400);

  if (req.method === "GET") {
    const room = await store.get(roomKey(code), { type: "json" });
    return room ? json({ room }) : json({ error: "Sala nao encontrada." }, 404);
  }

  if (req.method === "PUT" || req.method === "POST") {
    const room = await req.json();
    if (!room || cleanCode(room.code) !== code) {
      return json({ error: "Dados da sala invalidos." }, 400);
    }

    room.updatedAt = Date.now();
    await store.setJSON(roomKey(code), room);
    return json({ room });
  }

  return json({ error: "Metodo nao permitido." }, 405);
};

export const config = {
  path: ["/api/rooms", "/api/rooms/:code"]
};
