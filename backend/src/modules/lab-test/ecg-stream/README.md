# ECG stream realtime (từng điểm) — Socket.IO namespace `/ecg-stream`

Phát tín hiệu ECG theo thời gian thực, **mỗi mẫu một message**. Auth/CORS dùng cùng quy ước `/lab-alerts`:
JWT trong `auth.token` (hoặc header `Authorization: Bearer`), vai trò DOCTOR / LAB_STAFF / NURSE / ADMIN;
`LAB_ALERT_REQUIRE_AUTH=false` để tắt khi dev; `LAB_ALERT_CORS_ORIGINS`.

## Hai API

| | API [1] | API [2] |
|---|---|---|
| Client emit | `stream-ecg` | `stream-ecg-anomaly` |
| Server push (mỗi điểm) | `ecg-point` | `ecg-point-anomaly` |
| Payload điểm | `{ streamId, source, sourceName, lead, seq, tMs, value }` | như [1] **+ `isAnomaly: 0 \| 1`** |

## Nguồn tín hiệu — chọn ĐÚNG MỘT (cả hai API)

| Nguồn | Trường gửi | Ghi chú |
|---|---|---|
| **Upload** | `file` (Blob/ArrayBuffer/Buffer) + `fileName` (`.npy`/`.csv`) + `sampleRateHz` (50–4000, bắt buộc) + `leadNames?` | `.npy`/`.csv` không chứa tần số lấy mẫu nên phải gửi kèm. Tối đa `ECG_STREAM_MAX_UPLOAD_BYTES` (mặc định 10MB). |
| **Dataset có sẵn** | `dataset`: `"ECG_A"` … `"ECG_F"` (không phân biệt hoa/thường) | Danh sách + tình trạng cài đặt: `list-ecg-datasets`. Xem `datasets/ecg/README.md`. |
| Bản ghi đã lưu (luồng cũ) | `recordingId` (+ `analysisId?` với API [2]) | Đọc từ MinIO/DB như trước. |

Upload và dataset đi qua **cùng một đường xử lý** (đọc tín hiệu → chọn lead → phát), nên với cùng nội dung cho ra chuỗi điểm giống hệt nhau.

Tham số chung: `lead?` (tên `"II"` hoặc chỉ số; mặc định `II` nếu có, không thì lead đầu), `speed?` (0.1–8, mặc định 1 = đúng thời gian thực), `startMs?`.

## API [2] lấy nhãn anomaly từ đâu
- **Upload / dataset**: backend gọi dịch vụ AI (`POST {ECG_AI_BASE_URL}/v1/ecg/analyze`, model `active` hiện hành) ngay lúc bắt đầu stream, lấy các đoạn bất thường rồi gán `isAnomaly` cho từng điểm. **Ack chỉ được trả sau khi AI xong** (vài giây) → client nên đặt timeout lớn, vd `socket.timeout(90_000).emit(...)`. Kết quả của *dataset* được cache theo (tệp, model) nên các lần sau trả ngay; *upload* luôn gọi AI lại.
- **recordingId**: dùng các đoạn bất thường đã lưu của lần phân tích `isCurrent` (hoặc `analysisId` chỉ định); chưa có analysis `completed` → `ANALYSIS_NOT_READY`.
- Tín hiệu phải đúng số lead của model (mặc định 2, `ECG_REQUIRED_LEADS`) → nếu không: `LEAD_COUNT_MISMATCH`.
- `isAnomaly = 1` ⇔ `tMs` nằm trong `[startOffsetMs, endOffsetMs]` (gồm cả hai đầu) của ít nhất một đoạn bất thường.

## Luồng
```
client                                   server
  │ stream-ecg / stream-ecg-anomaly ───▶  validate → (đọc tệp | gọi AI) 
  │ ◀─ ack { status:'streaming', streamId, source, sourceName, lead, sampleRateHz, totalPoints, durationMs, speed, startMs, withAnomaly,
  │          (API 2) overallResult, anomalyPointCount, (recording) analysisId }
  │ ◀─ ecg-point | ecg-point-anomaly  × N   (đúng nhịp sampleRateHz × speed)
  │ ◀─ ecg-stream-end { streamId, source, sourceName, totalPoints }
  │ stream-ecg-stop ───────────────────▶  dừng (kể cả đang chờ AI → start đó nhận CANCELLED)
```
Mỗi socket 1 stream; bắt đầu stream mới huỷ stream cũ; ngắt kết nối cũng dừng.

Lỗi khi bắt đầu trả qua ack `{ status:'error', code, message }` hoặc `{ status:'forbidden' }`. Mã lỗi:
`INVALID_REQUEST`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `RECORDING_NOT_FOUND`, `RECORDING_NOT_READY`, `DATASET_NOT_AVAILABLE`,
`SIGNAL_FORMAT_NOT_STREAMABLE`, `SIGNAL_PARSE_FAILED`, `SIGNAL_LOAD_FAILED`, `LEAD_NOT_FOUND`, `LEAD_COUNT_MISMATCH`,
`ANALYSIS_NOT_READY`, `AI_MODEL_NOT_FOUND`, `AI_NOT_CONFIGURED`, `AI_TIMEOUT`, `AI_UNAVAILABLE`, `AI_HTTP_<status>`, `AI_INVALID_RESPONSE`,
`CANCELLED`, `INTERNAL_ERROR`.

## Cấu hình
| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ECG_DATASET_DIR` | `<cwd>/datasets/ecg` | Thư mục chứa ECG_A..F |
| `ECG_DATASET_SAMPLE_RATE_HZ` | `100` | Tần số lấy mẫu mặc định của dataset (ghi đè từng dataset bằng `meta.json`) |
| `ECG_STREAM_MAX_UPLOAD_BYTES` | `10485760` | Dung lượng tối đa tệp upload qua socket (trần 50MB) |

> Nhận upload qua socket cần nâng `maxHttpBufferSize` (mặc định Socket.IO chỉ 1MB) — làm trong `EcgStreamIoAdapter`, đăng ký ở `main.ts`
> (đặt trong decorator gateway sẽ vô hiệu vì Nest chỉ dùng option của gateway đầu tiên). Giới hạn này áp dụng cho **mọi** namespace,
> kể cả `/queue-display` (không cần đăng nhập). Nếu ngại điều đó, đổi sang upload bằng REST rồi stream theo `uploadId`.

## Giới hạn
- Upload chỉ nhận `.npy`/`.csv`; bản ghi đã lưu stream được `csv`/`json`/`npy`. `wfdb`/`edf`/`dicom_ecg`/`scp_ecg` → `SIGNAL_FORMAT_NOT_STREAMABLE`.
- Đây là **phát lại** tín hiệu có sẵn, chưa phải nhận luồng trực tiếp từ thiết bị (`live_stream`).
- `value` giữ nguyên đơn vị trong tệp (không đổi µV/mV).
- ~`sampleRateHz` message/giây/client (500Hz = 500 msg/s); chưa có chế độ gộp batch.

## Ví dụ client
```ts
import { io } from 'socket.io-client';
const s = io(`${BASE}/ecg-stream`, { auth: { token } });

s.emit('list-ecg-datasets', {}, ({ datasets }) => fillDropdown(datasets)); // ECG_A..F + available

s.on('ecg-point-anomaly', ({ tMs, value, isAnomaly }) => plot(tMs, value, isAnomaly));
s.on('ecg-stream-end', () => console.log('hết tín hiệu'));

// Trường hợp 1: upload file (input.files[0] là .npy hoặc .csv)
s.timeout(90_000).emit('stream-ecg-anomaly',
  { file: input.files[0], fileName: input.files[0].name, sampleRateHz: 100 },
  (err, ack) => { if (err || ack.status !== 'streaming') console.error(err ?? ack); });

// Trường hợp 2: chọn tên dataset
s.timeout(90_000).emit('stream-ecg-anomaly', { dataset: 'ECG_A' }, (err, ack) => { /* như trên */ });
// API [1] (không nhãn): đổi 'stream-ecg-anomaly' -> 'stream-ecg', lắng nghe 'ecg-point'.
```
