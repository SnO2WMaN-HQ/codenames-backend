import { Bson, Collection } from "mongo";

import { generateSlug } from "random-word-slugs";

export const slugsMap = new Map<string, string>();
export const roomsMap = new Map<string, Room>();
export const createRoomFactory = (
  roomsCol: Collection<Bson.Document>,
) =>
  (): { id: string; slug: string } => {
    const roomId = new Bson.ObjectId().toString();
    const roomSlug = generateSlug(3, { format: "kebab" });
    const newRoom = new Room(roomId, roomsCol);

    slugsMap.set(roomSlug, roomId);
    roomsMap.set(roomId, newRoom);

    return { id: roomId, slug: roomSlug };
  };

export const findRoomFactory = () =>
  (slug: string) => {
    const roomId = slugsMap.get(slug);
    if (!roomId) return undefined;

    const room = roomsMap.get(roomId);
    if (!room) return undefined;

    return room;
  };

class Room {
  private readonly id: string;
  private readonly sockets: Set<WebSocket>;
  private readonly players: Map<string, { name: string }>;

  private coll: Collection<Bson.Document>;

  private breakTimeout: number | null;
  constructor(id: string, collection: Collection<Bson.Document>) {
    this.id = id;
    this.sockets = new Set();
    this.players = new Map();

    this.coll = collection;

    this.breakTimeout = null;
  }

  addSocket(ws: WebSocket) {
    this.sockets.add(ws);

    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (!("method" in data)) {
        console.error("No method");
        return;
      }

      switch (data.method) {
        case "JOIN": {
          const { payload } = data;
          const { playerId = crypto.randomUUID() } = payload;

          if (!this.players.has(playerId)) {
            this.players.set(playerId, { name: generateSlug(1) });
          }

          this.broadcast(playerId);
          break;
        }
        case "RENAME": {
          const { payload } = data;
          const { playerId, newName } = payload;

          if (!playerId || typeof playerId !== "string") break;
          if (!newName || typeof newName !== "string") break;
          if (!this.players.has(playerId)) break;

          const prev = this.players.get(playerId)!;
          this.players.set(playerId, { ...prev, name: newName });

          this.broadcast(playerId);

          break;
        }
      }
    });
  }

  removeSocket(ws: WebSocket) {
    this.sockets.delete(ws);
  }

  private broadcast(trigger: string) {
    const players: { id: string; name: string }[] = Array
      .from(this.players.entries())
      .map(([id, { name }]) => ({
        id: id,
        name: name,
        isYou: trigger === id,
      }));
    const payload = { players };

    const data = JSON.stringify({
      method: "UPDATE_ROOM_INFO",
      payload: payload,
    });
    this.sockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  }

  private postponeBreak() {
    if (this.breakTimeout) clearTimeout(this.breakTimeout);
    this.breakTimeout = setTimeout(async () => {
      await this.saveRoom();
    }, 60 * 60 * 10);
  }

  private async saveRoom() {
    /*
    await roomsCol.insertOne({
      slug: slug,
      expired: false,
      createdAt: new Date(),
      players: {},
    });
    */
    /*
    await this.coll.findAndModify(
      { _id: new Bson.ObjectId(this.id) },
      {
        update: {},
        upsert: true,
        new: true,
        fields: { "players": true },
      },
    );
    */
  }
}
