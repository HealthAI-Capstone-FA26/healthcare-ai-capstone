# Benchmark ECG AI

Đo dịch vụ AI qua **đúng adapter production** (`HttpEcgAnomalyProvider`): kiểm cả hợp đồng HTTP, kiểm tra phản hồi, độ trễ — không chỉ độ chính xác.

## Chạy trên dữ liệu benchmark của bạn
1. Chuẩn bị thư mục chứa các bản ghi + `manifest.jsonl` (mỗi dòng 1 JSON, `file` tính từ thư mục manifest):
```json
{"id":"rec001","file":"rec001.csv","format":"csv","sampleRateHz":500,"numLeads":12,"leadNames":["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"],"label":"abnormal","subtype":"afib"}
```
   - `label`: `normal` | `abnormal` | `unusable` (tín hiệu hỏng — kỳ vọng AI trả `poor_signal`/`inconclusive`).
   - `subtype`: nhóm bất thường (afib, pvc, st_elevation...) để xem recall theo nhóm.
   - Quy đổi nhãn gốc (PTB-XL, MIT-BIH, CPSC...) về `normal/abnormal` là việc của bạn — harness không đoán nhãn.
   - `wfdb`: nén `.hea` + `.dat` thành `.zip`.
2. Chạy:
```bash
npx tsx tools/ecg-benchmark/run-benchmark.ts \
  --manifest path/to/manifest.jsonl --base-url http://localhost:8000 \
  [--threshold 0.5] [--concurrency 2] [--timeout 60000] [--api-key KEY] [--out tools/ecg-benchmark/out]
```
3. Kết quả: `out/report.md` (đọc) + `out/results.json` (từng bản ghi + chỉ số, để so sánh giữa các model/ngưỡng).

## Cách đọc chỉ số
- Dương = `overallResult: "abnormal"`. `inconclusive`/`poor_signal`/lỗi dịch vụ = **không quyết định**.
- **Sensitivity/Specificity "chỉ ca quyết định"**: tính trên ca AI dám kết luận. **"Xấu nhất"**: ca không quyết định bị tính là sai — đây là con số trung thực cho an toàn lâm sàng (AI né ca khó sẽ làm số đầu đẹp giả).
- **Coverage** = tỷ lệ ca AI quyết định được. **AUROC** dùng `maxAnomalyScore` (thiếu = 0), không phụ thuộc ngưỡng.
- **"Tín hiệu rác bị kết luận"** > 0 là cờ đỏ: AI kết luận trên tín hiệu không dùng được.
- Quét ngưỡng: chạy nhiều lần với `--threshold 0.3/0.5/0.7` rồi so `results.json`.
- Đánh giá model `candidate`: chạy thẳng vào dịch vụ của model đó; sau đó có thể ghi `metrics` vào `AiModelVersion.evaluationMetrics`.

## Thử khi chưa có dịch vụ Python
```bash
npx tsx tools/ecg-benchmark/generate-fixtures.ts              # sinh 35 bản ghi TỔNG HỢP
npx tsx tools/ecg-benchmark/mock-ai-server.ts 8099 &         # server mẫu (heuristic RR, chỉ đọc CSV)
npx tsx tools/ecg-benchmark/run-benchmark.ts --manifest tools/ecg-benchmark/fixtures/manifest.jsonl --base-url http://localhost:8099
```
⚠️ Dữ liệu tổng hợp + server mẫu **chỉ để kiểm tra harness/hợp đồng**. Kết quả 100% ở đó dễ phân tách nên **không có ý nghĩa lâm sàng** và không nói gì về model thật.
