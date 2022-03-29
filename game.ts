import arraySampleSize from "lodash/arraySampleSize";
import range from "lodash/range";

const WORDS_URL =
  "https://raw.githubusercontent.com/jbowens/codenames/dca470ca8ba7394ee92404af31702801dd771502/assets/original.txt";

const res = await fetch(WORDS_URL);
const deck = await res.text().then((v) => v.split("\n"));

export const sampleWords = (words: string[], n: number) =>
  arraySampleSize(words, n);

export const sortingCards = (
  n: number,
  pk: number[],
  black: number,
): number[][] => {
  const sample = black + pk.reduce((p, c) => p + c, 0);
  if (n < sample) throw new Error("Sample size is larger than range");

  const shuffle = arraySampleSize(range(n), sample);
  return [black, ...pk].reduce(
    (p: [number, number][], c) => [
      ...p,
      p.length === 0
        ? [0, c] as [number, number]
        : [p[p.length - 1][1], p[p.length - 1][1] + c] as [number, number],
    ],
    [],
  ).map(([s, e]) => shuffle.slice(s, e));
};

export class Game {
  private teamsCount: number;
  private playerRoles: Map<string, {
    team: number; // turn + 1

    spymaster: boolean;
  }>;

  private deck: {
    word: string;
    role: number;
    suggestedBy: Set<string>;
    revealed: boolean;
  }[];
  private history: (
    | { type: "add_suggest"; playerId: string; key: number }
    | { type: "remove_suggest"; playerId: string; key: number }
    | { type: "select"; playerId: string; key: number }
    | { type: "join_operative"; playerId: string; team: number }
    | { type: "join_spymaster"; playerId: string; team: number }
  )[];

  private turn: number;

  constructor(words: string[], teamAssign: number[][], deadAssign: number[]) {
    this.deck = words.map((word, index) => ({
      word: word,
      role: deadAssign.includes(index)
        ? -1
        : teamAssign.findIndex((tm) => tm.includes(index)) + 1,
      suggestedBy: new Set(),
      revealed: false,
    }));

    this.teamsCount = teamAssign.length;
    this.playerRoles = new Map();

    this.history = [];
    this.turn = 0;
  }

  represent(playerId: string) {
    const isSpymaster = this.playerRoles.get(playerId)?.spymaster || false;

    const deck: {
      key: number;
      word: string;
      suggestedBy: string[];
      role: number | null;
    }[] = this.deck.map(
      ({ word, suggestedBy, role, revealed }, i) => (
        {
          key: i,
          word,
          role: isSpymaster || revealed ? role : null,
          suggestedBy: Array.from(suggestedBy.values()),
        }
      ),
    );
    const teams: {
      operatives: { playerId: string }[];
      spymasters: { playerId: string }[];
    }[] = [...new Array(this.teamsCount)].map((_, i) => ({
      operatives: Array
        .from(this.playerRoles.entries())
        .filter(([, { team, spymaster }]) => (!spymaster && team === i + 1))
        .map(([playerId]) => ({ playerId })),
      spymasters: Array
        .from(this.playerRoles.entries())
        .filter(([, { team, spymaster }]) => (spymaster && team === i + 1))
        .map(([playerId]) => ({ playerId })),
    }));

    return {
      turn: this.turn + 1,
      deck,
      teams,
    };
  }

  addSuggest(playerId: string, key: number): boolean {
    if (key < 0 || this.deck.length <= key) return false;

    if (this.deck[key].suggestedBy.has(playerId)) return false;

    const player = this.playerRoles.get(playerId);
    if (!player || player.spymaster || this.turn === player.team) return false;

    this.deck[key].suggestedBy.add(playerId);
    this.history.push({ type: "add_suggest", key, playerId });

    return true;
  }

  removeSuggest(playerId: string, key: number): boolean {
    if (key < 0 || this.deck.length <= key) return false;
    if (!this.deck[key].suggestedBy.has(playerId)) return false;

    const player = this.playerRoles.get(playerId);
    if (!player || player.spymaster || this.turn === player.team) return false;

    this.deck[key].suggestedBy.delete(playerId);
    this.history.push({ type: "remove_suggest", key, playerId });

    return true;
  }

  select(playerId: string, key: number): boolean {
    if (key < 0 || this.deck.length <= key) return false;

    const player = this.playerRoles.get(playerId);
    if (
      !player || // not exists player ||
      this.turn === player.team || // not in current team
      player.spymaster // not operative
    ) {
      return false;
    }

    this.history.push({ type: "select", playerId, key });

    this.deck[key].revealed = true;
    this.deck[key].suggestedBy.clear();

    if (this.deck[key].role === this.turn + 1) { // correct
    } else if (this.deck[key].role === -1) { // killer
    } else { // wrong
      this.turn = (this.turn + 1) % this.teamsCount; // turn
    }

    return true;
  }

  joinOperative(playerId: string, team: number): boolean {
    if (team < 1 || this.teamsCount < team) return false;

    const player = this.playerRoles.get(playerId);
    if (
      player // if player belong to somewhere
    ) {
      return false;
    }

    this.playerRoles.set(playerId, { team, spymaster: false });
    this.history.push({ type: "join_operative", playerId, team });

    return true;
  }

  joinSpymaseter(playerId: string, team: number): boolean {
    if (team < 1 || this.teamsCount < team) return false;

    const player = this.playerRoles.get(playerId);
    if (
      player && (
        player.team !== team || // if player belong to somewhere and choose other team
        player.spymaster // if player belong to somewhere and already spymaster
      )
    ) {
      return false;
    }

    this.playerRoles.set(playerId, { team, spymaster: true });
    this.history.push({ type: "join_spymaster", playerId, team });

    return true;
  }
}

export const createGame = (
  rules: {
    wordsCount: number;
    wordsAssign: number[];
    deadWords: number;
  },
) => {
  const words = sampleWords(
    deck,
    rules.wordsCount,
  );
  const [dead, ...teams] = sortingCards(
    rules.wordsCount,
    rules.wordsAssign,
    rules.deadWords,
  );

  return new Game(words, teams, dead);
};
