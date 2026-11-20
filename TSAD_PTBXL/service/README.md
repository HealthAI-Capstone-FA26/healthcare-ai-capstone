# Dịch vụ AI ECG (FastAPI)

Bọc `Detector` (bundle `ECG_wsize100_deploy.pt`) thành HTTP đúng hợp đồng backend: `POST /v1/ecg/analyze`.

```bash
# local (từ thư mục gốc TSAD_PTBXL)
pip install -r service/requirements-service.txt torch
ECG_BUNDLE_PATH=checkpoints/ECG_wsize100_deploy.pt uvicorn service.app:app --port 8000
curl localhost:8000/health

# docker (build từ gốc TSAD_PTBXL)
docker build -f Dockerfile.service -t ecg-ai .
docker run -p 8000:8000 -v $PWD/checkpoints:/app/checkpoints:ro ecg-ai
```

- Định dạng hỗ trợ: `csv`, `json` (2 kênh; mỗi dòng = 1 step, không resample). Định dạng khác -> HTTP 422.
- Detection nhị phân theo step; đoạn liên tiếp được gộp thành 1 `anomaly`, `anomalyType = null`, severity = `ECG_AI_SEVERITY`.
- `poor_signal` (NaN > 20% / kênh phẳng) và `inconclusive` (sai số kênh / ngắn hơn win_size) trả 200, không có anomaly.
- Test: `pytest tests/test_service_postprocess.py`
