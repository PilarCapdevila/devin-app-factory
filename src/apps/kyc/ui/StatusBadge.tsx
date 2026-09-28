import type { CaseStatus } from "../types";
import { STATUS_STYLES } from "./shared";

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>{status.replace("_", " ")}</span>;
}
