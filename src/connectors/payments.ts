import type { Tx } from "@/platform/db";

/**
 * Payments connector (SPEC.md §4: external systems are reached only through src/connectors/*).
 * The only caller is the refunds approval action's onConfirm (src/apps/refunds/register.ts);
 * tests/unit/refunds.test.ts asserts nothing else imports this module.
 */
export type IssueRefundInput = {
  paymentId: string;
  amountCents: number;
  /** Approval request id: retrying the same confirmation never issues a second refund. */
  idempotencyKey: string;
};

export type IssueRefundResult = {
  providerRefundId: string;
  /** True when the key was already used and the earlier result was returned. */
  replayed: boolean;
};

export interface PaymentsConnector {
  issueRefund(input: IssueRefundInput): Promise<IssueRefundResult>;
}

/**
 * Mock implementation: records every call in MockPaymentCall inside the caller's transaction,
 * so a confirmation that fails afterwards leaves no orphan "issued" call behind.
 */
export function mockPaymentsConnector(tx: Tx): PaymentsConnector {
  return {
    async issueRefund({ paymentId, amountCents, idempotencyKey }) {
      const existing = await tx.mockPaymentCall.findUnique({ where: { idempotencyKey } });
      if (existing) return { providerRefundId: existing.providerRefundId, replayed: true };
      const call = await tx.mockPaymentCall.create({
        data: { paymentId, amountCents, idempotencyKey, providerRefundId: `mock_re_${idempotencyKey}` },
      });
      return { providerRefundId: call.providerRefundId, replayed: false };
    },
  };
}

/** Connector used by the app. Only the mock exists; a real provider would be selected here. */
export function getPaymentsConnector(tx: Tx): PaymentsConnector {
  return mockPaymentsConnector(tx);
}
