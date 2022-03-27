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
  private readonly players: Map<string, { name: string; isHost: boolean }>;

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
          const { player_id: playerId } = payload;

          const actualPlayerId: string = playerId === null
            ? crypto.randomUUID()
            : playerId;

          if (!this.players.has(actualPlayerId)) {
            this.players.set(actualPlayerId, {
              name: generateSlug(1),
              isHost: false,
            });
          }
          if (this.players.size === 1) {
            this.players.set(actualPlayerId, {
              ...this.players.get(actualPlayerId)!,
              isHost: true,
            });
          }

          this.sendJoined(ws, actualPlayerId);
          this.sendUpdateRoom(ws, actualPlayerId);
          break;
        }
        case "RENAME": {
          const { payload } = data;
          const { player_id: playerId, new_name: newName } = payload;

          if (!playerId || typeof playerId !== "string") break;
          if (!newName || typeof newName !== "string") break;
          if (!this.players.has(playerId)) break;

          const prev = this.players.get(playerId)!;
          this.players.set(playerId, { ...prev, name: newName });

          this.sendUpdateRoom(ws, playerId);

          break;
        }
      }
    });
  }

  removeSocket(ws: WebSocket) {
    this.sockets.delete(ws);
  }

  private sendJoined(ws: WebSocket, playerId: string) {
    ws.send(JSON.stringify(
      { method: "JOINED", payload: { player_id: playerId } },
    ));
  }

  private sendUpdateRoom(ws: WebSocket, trigger: string) {
    const players: { id: string; name: string }[] = Array
      .from(this.players.entries())
      .map(([id, { name, isHost }]) => ({
        id: id,
        name: name,
        is_host: isHost,
      }));

    this.sockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(
          {
            method: "UPDATE_ROOM",
            payload: { players },
          },
        ));
      }
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
