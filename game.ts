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
  private readonly deck: {
    word: string;
    role: number;
    suggestedBy: Set<string>;
  }[];
  private readonly history:
    ({ type: "suggest"; playerId: string; key: number })[];

  constructor(words: string[], teamAssign: number[][], deadAssign: number[]) {
    this.deck = words.map((word, index) => ({
      word: word,
      role: deadAssign.includes(index)
        ? -1
        : teamAssign.findIndex((tm) => tm.includes(index)) + 1,
      suggestedBy: new Set(),
    }));
    this.history = [];
  }

  repesentForAll(): {
    deck: { key: number; word: string; suggestedBy: string[] }[];
  } {
    return {
      deck: this.deck.map(
        ({ word, suggestedBy }, i) => (
          {
            key: i,
            word,
            suggestedBy: Array.from(suggestedBy.values()),
          }
        ),
      ),
    };
  }

  private isSpyMaseter(playerId: string) {
    return true;
  }

  suggest(playerId: string, key: number): boolean {
    if (key < 0 || this.deck.length <= key) return false;

    this.deck[key].suggestedBy.add(playerId);
    this.history.push({ type: "suggest", key, playerId });

    return true;
  }

  select(playerId: string, key: number): boolean {
    if (key < 0 || this.deck.length <= key) return false;

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
