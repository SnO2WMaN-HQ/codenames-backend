import { Bson, Collection } from "mongo";

import { generateSlug } from "random-word-slugs";

import { createGame, Game } from "./game.ts";

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
  private readonly players: Map<string, { name: string; isHost: boolean }>;

  private coll: Collection<Bson.Document>;

  private breakTimeout: number | null;

  private currentGame: Game | null;
  private socketsMap: Map<WebSocket, { playerId: string }>;

  constructor(id: string, collection: Collection<Bson.Document>) {
    this.id = id;
    this.players = new Map();

    this.coll = collection;

    this.currentGame = null;

    this.breakTimeout = null;

    this.socketsMap = new Map();
  }

  addSocket(ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (!("method" in data)) {
        console.error("No method");
        return;
      }

      switch (data.method) {
        case "JOIN": {
          const { payload } = data;
          this.receivedJoin(ws, payload);
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
        case "START_GAME": {
          if (this.currentGame) {
            // TODO: すでに始まっているのにゲーム開始したときの挙動
            return;
          }

          const { payload } = data;
          const {
            player_id: playerId,
            words_count: wordsCount,
            words_assign: wordsAssign,
            dead_words: deadWords,
          } = payload;

          // TODO: check player is host?

          this.currentGame = createGame({ deadWords, wordsAssign, wordsCount });
          this.sendUpdateRoom(ws, playerId);
          this.reqSyncGame();
          break;
        }
        case "UPDATE_GAME": {
          const { payload } = data;
          this.receievedUpdateGame(ws, payload);
          break;
        }
      }
    });
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

    this.socketsMap.forEach(({ playerId }, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          method: "UPDATE_ROOM",
          payload: { players, is_playing: this.currentGame !== null },
        }));
      }
    });
  }

  private receivedJoin(ws: WebSocket, payload: unknown) {
    if (!payload || typeof payload !== "object" || !("player_id" in payload)) {
      return; // TODO: no type
    }

    const playerId: string = "player_id" in payload
      ? (payload as { player_id: string })["player_id"]
      : crypto.randomUUID();

    if (!this.players.has(playerId)) {
      this.players.set(
        playerId,
        {
          name: generateSlug(1),
          isHost: false,
        },
      );
    }
    if (this.players.size === 1) {
      this.players.set(
        playerId,
        {
          ...this.players.get(playerId)!,
          isHost: true,
        },
      );
    }

    this.socketsMap.set(ws, { playerId: playerId });

    this.sendJoined(ws, playerId);
    this.sendUpdateRoom(ws, playerId);
    this.reqSyncGame();
  }

  private receievedUpdateGame(ws: WebSocket, payload: unknown) {
    if (!this.currentGame) return; // TODO: no game
    if (!payload || typeof payload !== "object" || !("type" in payload)) return; // TODO: no type

    switch ((payload as { type: string }).type) {
      case "add_suggest": {
        if (
          !((p): p is { player_id: string; key: number } =>
            "player_id" in p && typeof (p as any).player_id === "string" &&
            "key" in p && typeof (p as any).key === "number")(payload)
        ) {
          break;
        }

        const { player_id: playerId, key } = payload;
        this.currentGame.addSuggest(playerId, key);
        this.reqSyncGame();
        break;
      }
      case "remove_suggest": {
        if (
          !((p): p is { player_id: string; key: number } =>
            "player_id" in p && typeof (p as any).player_id === "string" &&
            "key" in p && typeof (p as any).key === "number")(payload)
        ) {
          break; // TODO: invalid payload
        }

        const { player_id: playerId, key } = payload;
        this.currentGame.removeSuggest(playerId, key);
        this.reqSyncGame();
        break;
      }
      case "select": {
        if (
          !((p): p is { player_id: string; key: number } =>
            "player_id" in p && typeof (p as any).player_id === "string" &&
            "key" in p && typeof (p as any).key === "number")(payload)
        ) {
          break;
        }
        const { player_id: playerId, key } = payload;
        this.currentGame.select(playerId, key);
        this.reqSyncGame();
        break;
      }
      case "join_operative": {
        if (
          !((p): p is { player_id: string; team: number } =>
            "player_id" in p && typeof (p as any).player_id === "string" &&
            "team" in p && typeof (p as any).team === "number")(payload)
        ) {
          break;
        }
        const { player_id: playerId, team } = payload;
        this.currentGame.joinOperative(playerId, team);
        this.reqSyncGame();
        break;
      }
      case "join_spymaster": {
        if (
          !((p): p is { player_id: string; team: number } =>
            "player_id" in p && typeof (p as any).player_id === "string" &&
            "team" in p && typeof (p as any).team === "number")(payload)
        ) {
          break;
        }
        const { player_id: playerId, team } = payload;
        this.currentGame.joinSpymaseter(playerId, team);
        this.reqSyncGame();
        break;
      }
      default: { // invalid type
        break;
      }
    }
  }

  private reqSyncGame() {
    if (!this.currentGame) return;

    this.socketsMap.forEach(({ playerId }, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        const represent = this.currentGame!.represent(playerId);
        if (!represent) return;

        const payload: {
          turn: number;
          deck: { key: number; word: string; suggested_by: string[] }[];
          teams: {
            operatives: { player_id: string }[];
            spymasters: { player_id: string }[];
          }[];
        } = {
          turn: represent.turn,
          deck: represent.deck.map(({ key, suggestedBy, word, role }) => ({
            key,
            word,
            role,
            suggested_by: suggestedBy,
          })),
          teams: represent.teams.map(({ operatives, spymasters }) => ({
            operatives: operatives.map(({ playerId }) => ({
              player_id: playerId,
            })),
            spymasters: spymasters.map(({ playerId }) => ({
              player_id: playerId,
            })),
          })),
        };
        ws.send(JSON.stringify({ method: "SYNC_GAME", payload: payload }));
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
