import { Bson, Collection } from "mongo";

import { generateSlug } from "random-word-slugs";

import { createGame, Game, HistoryItem } from "./game.ts";

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

export type SyncGamePayload = {
  end: boolean;
  current_hint: { word: string; count: number } | null;
  current_turn: number;
  deck: { key: number; word: string; suggested_by: string[] }[];
  teams: {
    rank: number | null;
    operatives: { player_id: string }[];
    spymasters: { player_id: string }[];
  }[];
  history: (
    | { type: "submit_hint"; player_id: string; word: string; count: number }
    | { type: "select_card"; player_id: string; key: number }
    | { type: "lose_team"; team: number }
    | { type: "end_turn"; team: number }
    | { type: "start_turn"; team: number }
    | { type: "end_game" }
  )[];
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
          this.requestSyncGame();
          break;
        }
        case "CLOSE_GAME": {
          const { payload } = data;
          this.recievedCloseGame(ws, payload);
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

    const playerId: string = (payload as { player_id: string })["player_id"] ||
      crypto.randomUUID();

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
    this.requestSyncGame();
  }

  private recievedCloseGame(ws: WebSocket, payload: unknown) {
    this.currentGame = null;
    this.sendUpdateRoom(ws, "");
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
        if (this.currentGame.addSuggest(playerId, key)) {
          this.requestSyncGame();
        }
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
        if (this.currentGame.removeSuggest(playerId, key)) {
          this.requestSyncGame();
        }
        break;
      }
      case "select_card": {
        if (
          !((p): p is { player_id: string; key: number } =>
            "player_id" in p && typeof (p as any).player_id === "string" &&
            "key" in p && typeof (p as any).key === "number")(payload)
        ) {
          break;
        }
        const { player_id: playerId, key } = payload;
        if (this.currentGame.selectCard(playerId, key)) {
          this.requestSyncGame();
        }
        break;
      }
      case "submit_hint": {
        if (
          !((p): p is { player_id: string; word: string; count: number } =>
            "player_id" in p && typeof (p as any).player_id === "string" &&
            "word" in p && typeof (p as any).word === "string" &&
            "count" in p && typeof (p as any).count === "number")(payload)
        ) {
          break;
        }
        const { player_id: playerId, word, count } = payload;
        if (this.currentGame.submitHint(playerId, word, count)) {
          this.requestSyncGame();
        }
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
        this.requestSyncGame();
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
        if (this.currentGame.joinSpymaseter(playerId, team)) {
          this.requestSyncGame();
        }
        break;
      }
      default: { // invalid type
        break;
      }
    }
  }

  private requestSyncGame() {
    if (!this.currentGame) return;

    this.socketsMap.forEach(({ playerId }, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const payload = this.getSyncGamePayload(playerId);
      if (payload === null) return;

      ws.send(JSON.stringify({ method: "SYNC_GAME", payload: payload }));
    });
  }

  private getSyncGamePayload(playerId: string): SyncGamePayload | null {
    const represent = this.currentGame?.represent(playerId);
    if (!represent) return null;

    const deck = represent.deck.map(({ key, suggestedBy, word, role }) => ({
      key,
      word,
      role,
      suggested_by: suggestedBy,
    }));
    const teams = represent.teams.map(({ operatives, spymasters, rank }) => ({
      rank,
      operatives: operatives.map(({ playerId }) => ({
        player_id: playerId,
      })),
      spymasters: spymasters.map(({ playerId }) => ({
        player_id: playerId,
      })),
    }));
    const history = represent.history.filter(
      (item): item is Exclude<
        HistoryItem,
        | { type: "join_operative" }
        | { type: "join_spymaster" }
        | { type: "add_suggest" }
        | { type: "remove_suggest" }
      > =>
        item.type === "submit_hint" ||
        item.type === "select_card" ||
        item.type === "lose_team" ||
        item.type === "end_turn" ||
        item.type === "start_turn" ||
        item.type === "end_game",
    ).map((item): SyncGamePayload["history"][number] => {
      switch (item.type) {
        case "submit_hint":
          return {
            type: "submit_hint",
            player_id: item.playerId,
            word: item.word,
            count: item.count,
          };
        case "select_card":
          return {
            type: "select_card",
            player_id: item.playerId,
            key: item.key,
          };
        case "lose_team":
          return {
            type: "lose_team",
            team: item.team,
          };
        case "end_turn":
          return {
            type: "end_turn",
            team: item.team,
          };
        case "start_turn":
          return {
            type: "start_turn",
            team: item.team,
          };
        case "end_game":
          return {
            type: "end_game",
          };
      }
    });

    return {
      end: represent.end,
      current_hint: represent.currentHint
        ? {
          word: represent.currentHint.word,
          count: represent.currentHint.count,
        }
        : null,
      current_turn: represent.currentTurn,
      deck: deck,
      teams: teams,
      history: history,
    };
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
