/**
 * Prisma trả `BigInt` cho các cột `BigInt` (vd DiagnosticResultAttachment.sizeBytes, EcgRecording.signalSizeBytes).
 * `JSON.stringify` không serialize được BigInt -> Nest ném lỗi 500 khi trả response. Hàm này cài `toJSON` 1 lần
 * (idempotent) để BigInt được trả về dạng số (an toàn với kích thước file < 2^53) hoặc chuỗi nếu vượt ngưỡng.
 * Được gọi từ lab-test.module.ts; nên chuyển sang main.ts khi thuận tiện.
 */
export function installBigIntJsonSerializer(): void {
    const proto = BigInt.prototype as unknown as { toJSON?: () => number | string };
    if (typeof proto.toJSON === 'function') return;
    proto.toJSON = function (this: bigint) {
        return this <= BigInt(Number.MAX_SAFE_INTEGER) && this >= BigInt(Number.MIN_SAFE_INTEGER)
            ? Number(this)
            : this.toString();
    };
}
