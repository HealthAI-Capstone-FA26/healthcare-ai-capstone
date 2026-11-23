/**
 * Mã lỗi nghiệp vụ trả qua ack `{ status:'error', code, message }`.
 * Lỗi của dịch vụ AI giữ nguyên mã của EcgAiError (AI_NOT_CONFIGURED | AI_TIMEOUT | AI_UNAVAILABLE | AI_HTTP_<status> |
 * AI_INVALID_RESPONSE) nên `code` là string.
 */
export type EcgStreamErrorCode =
    | 'INVALID_REQUEST'
    | 'FILE_TOO_LARGE'
    | 'UNSUPPORTED_FILE_TYPE'
    | 'RECORDING_NOT_FOUND'
    | 'RECORDING_NOT_READY'
    | 'DATASET_NOT_AVAILABLE'
    | 'SIGNAL_FORMAT_NOT_STREAMABLE'
    | 'SIGNAL_PARSE_FAILED'
    | 'SIGNAL_LOAD_FAILED'
    | 'LEAD_NOT_FOUND'
    | 'LEAD_COUNT_MISMATCH'
    | 'ANALYSIS_NOT_READY'
    | 'AI_MODEL_NOT_FOUND';

export class EcgStreamError extends Error {
    constructor(
        public readonly code: EcgStreamErrorCode | string,
        message: string,
    ) {
        super(message);
        this.name = 'EcgStreamError';
    }
}
