import type { DueState } from "../types";
import { DUE_LABELS, DUE_STYLES } from "./shared";

export function DueBadge({ dueState }: { dueState: DueState }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${DUE_STYLES[dueState]}`}>{DUE_LABELS[dueState]}</span>;
}
