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

export type HistoryItem =
  | {
    type: "join_operative";
    playerId: string; // player id who joins
    team: number; // team number
  }
  | {
    type: "join_spymaster";
    playerId: string; // player id who joins
    team: number; // team number
  }
  | {
    type: "add_suggest";
    playerId: string; // player id who adds suggest
    key: number; // key of card
  }
  | {
    type: "remove_suggest";
    playerId: string; // player id who removes suggest
    key: number; // key of card
  }
  | {
    type: "submit_hint";
    playerId: string; // player id who submits
    word: string;
    count: number;
  }
  | {
    type: "select_card";
    playerId: string; // player id who select card
    key: number; // key of card
  }
  | {
    type: "lose_team";
    team: number; // team number
  }
  | {
    type: "end_turn";
    team: number;
  }
  | {
    type: "start_turn";
    team: number;
  }
  | {
    type: "end_game";
  };

export class Game {
  private teamsCount: number;
  private playerRoles: Map<
    string,
    {
      team: number; // turn + 1
      spymaster: boolean;
    }
  >;

  private deck: {
    word: string;
    role: number; // killer = -1, neutral = 0, other team = 1 =<
    suggestedBy: Set<string>;
    revealed: boolean;
  }[];
  private history: HistoryItem[];

  private currentTeam: number;
  private losedTeams: number[];
  private currentHint: { word: string; count: number } | null;

  private end: boolean;
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
    this.currentTeam = 1;
    this.currentHint = null;
    this.losedTeams = [];
    this.end = false;
  }

  represent(playerId: string): {
    end: boolean;
    currentTurn: number;
    currentHint: { word: string; count: number } | null;
    deck: {
      key: number;
      word: string;
      role: number | null;
      suggestedBy: string[];
    }[];
    teams: {
      rank: number | null;
      operatives: { playerId: string }[];
      spymasters: { playerId: string }[];
    }[];
    history: HistoryItem[];
  } {
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
      rank: number | null;
      operatives: { playerId: string }[];
      spymasters: { playerId: string }[];
    }[] = [...new Array(this.teamsCount)].map((_, i) => {
      const operatives = Array
        .from(this.playerRoles.entries())
        .filter(([, { team, spymaster }]) => (!spymaster && team === i + 1))
        .map(([playerId]) => ({ playerId }));
      const spymasters = Array
        .from(this.playerRoles.entries())
        .filter(([, { team, spymaster }]) => (spymaster && team === i + 1))
        .map(([playerId]) => ({ playerId }));

      const lostIndex = this.losedTeams.findIndex((v) => v == i + 1);
      const rank = lostIndex === -1
        ? (this.losedTeams.length === this.teamsCount - 1 ? 1 : null)
        : this.teamsCount - lostIndex;
      return {
        rank: rank,
        operatives: operatives,
        spymasters: spymasters,
      };
    });
    const history = this.history;

    return {
      end: this.end,
      currentHint: this.currentHint,
      currentTurn: this.currentTeam,
      deck,
      teams,
      history,
    };
  }

  joinOperative(playerId: string, team: number): boolean {
    if (this.end) return false;
    if (team < 1 || this.teamsCount < team) return false;

    const player = this.playerRoles.get(playerId);
    if (
      player // if player belong to somewhere
    ) {
      return false;
    }

    this.playerRoles.set(playerId, { team, spymaster: false });
    this.history.push({ type: "join_operative", playerId: playerId, team });

    return true;
  }

  joinSpymaseter(playerId: string, team: number): boolean {
    if (this.end) return false;
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
    this.history.push({ type: "join_spymaster", playerId: playerId, team });

    return true;
  }

  addSuggest(playerId: string, key: number): boolean {
    if (this.end) return false;
    if (!this.checkCorrectCardKey(key)) return false;

    if (this.deck[key].suggestedBy.has(playerId)) return false;

    const player = this.playerRoles.get(playerId);
    if (!player) return false; // not exists player
    if (player.spymaster) return false;
    if (player.team !== this.currentTeam) return false; // not current team

    this.deck[key].suggestedBy.add(playerId);
    this.history.push({ type: "add_suggest", key, playerId: playerId });

    return true;
  }

  removeSuggest(playerId: string, key: number): boolean {
    if (this.end) return false;
    if (!this.checkCorrectCardKey(key)) return false;
    if (!this.deck[key].suggestedBy.has(playerId)) return false;

    const player = this.playerRoles.get(playerId);
    if (!player) return false; // not exists player
    if (player.spymaster) return false;
    if (player.team !== this.currentTeam) return false; // not current team

    this.deck[key].suggestedBy.delete(playerId);
    this.history.push({ type: "remove_suggest", key, playerId: playerId });

    return true;
  }

  submitHint(playerId: string, word: string, count: number) {
    if (this.end) return false;
    if (this.currentHint !== null) return false; // already submit hint

    const player = this.playerRoles.get(playerId);

    if (!player) return false; // not exists player
    if (!player.spymaster) return false;
    if (player.team !== this.currentTeam) return false; // not current team

    this.currentHint = { count, word };
    this.history.push({
      type: "submit_hint",
      playerId: playerId,
      word: word,
      count,
    });
    return true;
  }

  selectCard(playerId: string, key: number): boolean {
    if (this.end) return false;
    if (!this.checkCorrectCardKey(key)) return false;

    if (this.currentHint === null) return false; // not submit hint

    const player = this.playerRoles.get(playerId);
    if (!player) return false; // not exists player
    if (player.spymaster) return false;
    if (player.team !== this.currentTeam) return false; // not current team

    this.deck[key].revealed = true;
    this.deck[key].suggestedBy.clear();
    this.history.push({ type: "select_card", playerId: playerId, key });

    if (this.deck[key].role === -1) { // killer
      this.loseTeam();
      this.checkEnd();
    } else if (this.deck[key].role !== player.team) { // wrong card
      this.endCurrentTurn();
      this.checkEnd();
      if (!this.end) this.startNextTurn();
    } else { // correct card
      this.checkEnd();
    }

    return true;
  }

  private endCurrentTurn() {
    this.currentHint = null;
    this.swipeSuggests();

    this.history.push({ type: "end_turn", team: this.currentTeam });
  }

  private startNextTurn() {
    for (let i = 0; i < this.teamsCount - 1; i++) {
      const next = this.currentTeam + i === this.teamsCount
        ? 1
        : this.currentTeam + i + 1;
      if (this.losedTeams.includes(next)) continue;

      this.currentTeam = next;
      this.history.push({ type: "start_turn", team: next });
    }
  }

  private loseTeam() {
    this.losedTeams.push(this.currentTeam);
    this.history.push({ type: "lose_team", team: this.currentTeam });
  }

  private checkEnd() {
    if (!(this.losedTeams.length === this.teamsCount - 1)) return;

    this.history.push({ type: "end_game" });
    this.end = true;
  }

  private swipeSuggests() {
    this.deck.map(({ suggestedBy }) => suggestedBy.clear());
  }

  private checkCorrectCardKey(key: number) {
    return 0 <= key || key < this.deck.length;
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
