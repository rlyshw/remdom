import type { PropertyOp, MutationOp } from "@remote-dom/protocol";

/**
 * Optimistic input manager.
 * For text fields: immediately apply local changes, then reconcile when
 * the server sends back the confirmed value.
 *
 * Phase 4 implementation — currently a passthrough.
 */

interface PendingInput {
  targetId: string;
  prop: string;
  localValue: unknown;
}

export class OptimisticManager {
  private pending: PendingInput[] = [];

  /**
   * Record an optimistic local update.
   * The caller should also apply it to the local DOM immediately.
   */
  recordOptimistic(targetId: string, prop: string, localValue: unknown): void {
    this.pending.push({ targetId, prop, localValue });
  }

  /**
   * Check if a server mutation op confirms or conflicts with a pending optimistic update.
   * Returns true if the op should be applied to the DOM (i.e., it's new info or a conflict correction).
   * Returns false if it's a confirmation of our optimistic update (no-op).
   */
  shouldApply(op: MutationOp): boolean {
    if (op.type !== "property") return true;

    const propOp = op as PropertyOp;
    const idx = this.pending.findIndex(
      (p) => p.targetId === propOp.targetId && p.prop === propOp.prop
    );

    if (idx === -1) return true; // Not something we predicted

    const predicted = this.pending[idx];
    this.pending.splice(idx, 1);

    // If server value matches our prediction, skip the DOM update
    if (predicted.localValue === propOp.value) {
      return false;
    }

    // Conflict: server wins, apply the server's value
    return true;
  }
}
