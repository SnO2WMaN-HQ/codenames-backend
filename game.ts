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
  private words: string[];
  private teamAssign: number[][];
  private deadAssign: number[];

  constructor(words: string[], teamAssign: number[][], deadAssign: number[]) {
    this.words = words;
    this.teamAssign = teamAssign;
    this.deadAssign = deadAssign;
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
