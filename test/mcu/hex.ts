export const hex = (text: string): readonly number[] =>
  text
    .trim()
    .split(/[\s,]+/)
    .map((pair) => parseInt(pair, 16))
