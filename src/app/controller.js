import { TrainingManagerController as IdempotencyController } from "./controller-idempotency-base.js";

const DEFAULT_RECEIPT_SETTLE_MS = 200;

function defaultAttemptId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to a local high-entropy identifier.
  }
  const randomPart = () => Math.random().toString(36).slice(2);
  return `${Date.now()}-${randomPart()}-${randomPart()}`;
}

export class TrainingManagerController extends IdempotencyController {
  constructor(options = {}) {
    super(options);
    this._attemptIdFactory = typeof options.attemptIdFactory === "function"
      ? options.attemptIdFactory
      : defaultAttemptId;
    const settleMs = Number(options.receiptSettleMs);
    this._receiptSettleMs = Number.isFinite(settleMs) && settleMs >= 0
      ? settleMs
      : DEFAULT_RECEIPT_SETTLE_MS;
  }

  async _reserveTrainReceipt(employee, trainsBefore, historyNewestTimestampBefore) {
    const id = Number(employee?.id);
    if (!Number.isInteger(id)) throw new Error("Employee not found");

    const current = await this._loadTrainReceipts(this.state.history);
    if (this._pendingReceipt(id, current)) {
      throw new Error("Previous train attempt is still pending verification; duplicate train blocked");
    }

    const uniquePart = String(this._attemptIdFactory() || "").trim();
    if (!uniquePart) throw new Error("Could not create a unique training attempt identifier");
    const attemptId = `${this.nowSeconds()}-${id}-${uniquePart}`;
    const receipt = {
      employeeId: id,
      employeeName: employee.name,
      attemptId,
      requestedAt: this.nowSeconds(),
      acceptedAt: null,
      trainsBefore: Number(trainsBefore),
      historyNewestTimestampBefore: Number(historyNewestTimestampBefore) || 0,
      status: "submitting"
    };

    const next = {
      schemaVersion: 1,
      receiptsByEmployeeId: {
        ...(current?.receiptsByEmployeeId || {}),
        [String(id)]: receipt
      }
    };
    await this._saveTrainReceipts(next);

    // GM storage has no compare-and-swap primitive. Give concurrent tabs a brief
    // chance to publish competing claims, then re-read the shared receipt and
    // allow only the surviving owner to cross the Torn POST boundary.
    if (this._receiptSettleMs > 0) await this.sleep(this._receiptSettleMs);
    const verify = await this._loadTrainReceipts(this.state.history);
    const winner = this._pendingReceipt(id, verify);
    if (winner?.attemptId !== attemptId) {
      throw new Error("Another training action acquired this employee first; duplicate train blocked");
    }

    return receipt;
  }
}
