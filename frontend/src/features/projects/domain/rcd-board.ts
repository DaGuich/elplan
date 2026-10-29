export function resolveRcdBoard(
  boards: readonly { id: number }[],
  selection: string,
): number | null | undefined {
  if (boards.length === 0) return null;
  if (boards.length === 1) return boards[0].id;
  const selected = Number(selection);
  return boards.some((board) => board.id === selected) ? selected : undefined;
}
