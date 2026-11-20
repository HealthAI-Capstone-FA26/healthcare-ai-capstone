# Dataset ECG cho stream realtime (chọn theo tên `ECG_A` … `ECG_F`)

Đặt tệp vào thư mục này (hoặc đổi thư mục bằng biến môi trường `ECG_DATASET_DIR`). Với mỗi dataset, backend tìm theo thứ tự:

1. `ECG_A/ECG_test.npy`   ← đúng bố cục thư mục train
2. `ECG_A/ECG_test.csv`
3. `ECG_A.npy`
4. `ECG_A.csv`

- Định dạng: `.npy` (float32/float64/int16/int32, shape `[mẫu, 2]` hoặc `[2, mẫu]`, hỗ trợ `fortran_order`) hoặc `.csv` (2 cột, có/không header).
- Tần số lấy mẫu: mặc định **100 Hz** (đúng ECG_A). Đổi chung bằng `ECG_DATASET_SAMPLE_RATE_HZ`, hoặc riêng từng dataset bằng `ECG_A/meta.json`:
  `{ "sampleRateHz": 100 }`
- Chỉ tín hiệu được dùng để stream/phân tích; nhãn `ECG_test_label.npy` (nếu có) bị bỏ qua — nhãn anomaly lấy từ model AI.
- Dataset chưa có tệp sẽ báo `DATASET_NOT_AVAILABLE`; `list-ecg-datasets` cho biết dataset nào đã cài.
