/** What a rename carried over to: "Also renamed 2 files made from it." */
export function followedMessage(count: number): string {
  return count === 1
    ? "Also renamed the file made from it."
    : `Also renamed the ${count} files made from it.`;
}
