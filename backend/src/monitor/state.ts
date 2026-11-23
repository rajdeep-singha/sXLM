import type { Finding } from "./checks.js";

export type Transition =
  | { kind: "fire"; finding: Finding }
  | { kind: "remind"; finding: Finding }
  | { kind: "resolve"; finding: Finding };

interface Active {
  finding: Finding;
  firedAt: number;
  lastSentAt: number;
}

/**
 * Turns each round of findings into what should be sent.
 *
 * A condition is announced when it starts, repeated every `reminderMs` while
 * it lasts, and announced again when it clears. Event findings (an admin
 * signature, a rate fall) are announced once each.
 */
export class AlertState {
  private readonly active = new Map<string, Active>();
  private readonly seenEvents = new Set<string>();

  constructor(private readonly reminderMs: number) {}

  update(findings: Finding[], now: number, checksRun: Set<string>): Transition[] {
    const out: Transition[] = [];
    const current = new Set<string>();

    for (const f of findings) {
      const id = `${f.name}:${f.key}`;
      if (f.event) {
        if (!this.seenEvents.has(id)) {
          this.seenEvents.add(id);
          out.push({ kind: "fire", finding: f });
        }
        continue;
      }
      current.add(id);
      const existing = this.active.get(id);
      if (!existing) {
        this.active.set(id, { finding: f, firedAt: now, lastSentAt: now });
        out.push({ kind: "fire", finding: f });
      } else {
        existing.finding = f;
        if (now - existing.lastSentAt >= this.reminderMs) {
          existing.lastSentAt = now;
          out.push({ kind: "remind", finding: f });
        }
      }
    }

    // Only resolve findings whose check actually ran this round. A check that
    // could not read its data says nothing about whether the condition cleared.
    for (const [id, a] of this.active) {
      // A `check_failed` finding is about the check named in its key; it
      // clears when that check next completes.
      const owner = a.finding.name === "check_failed" ? a.finding.key : a.finding.name;
      if (!current.has(id) && checksRun.has(owner)) {
        this.active.delete(id);
        out.push({ kind: "resolve", finding: a.finding });
      }
    }
    return out;
  }

  activeFindings(): Finding[] {
    return [...this.active.values()].map((a) => a.finding);
  }
}
