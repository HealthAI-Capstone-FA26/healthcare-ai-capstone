"""
Dịch vụ AI ECG (FastAPI) — hiện thực HỢP ĐỒNG mà backend NestJS đang gọi:
    POST /v1/ecg/analyze   multipart: `metadata` (JSON EcgAnalyzeMetadata) + `signal` (tệp)  ->  EcgAnalyzeResult
    (xem backend/src/modules/lab-test/ecg-ai-analysis/ecg-anomaly-provider.port.ts)

Chạy (từ thư mục gốc TSAD_PTBXL):  uvicorn service.app:app --host 0.0.0.0 --port 8000

Biến môi trường:
    ECG_BUNDLE_PATH            bundle deploy (mặc định checkpoints/ECG_wsize100_deploy.pt)
    ECG_AI_API_KEY             nếu đặt: bắt buộc header Authorization: Bearer <key> (khớp ECG_AI_API_KEY của backend)
    ECG_AI_DEVICE              cpu | cuda (mặc định cpu)
    ECG_AI_SEVERITY            severity gán cho mọi đoạn bất thường (mặc định high; backend chỉ gửi thông báo từ 'high')
    ECG_AI_MERGE_GAP_STEPS     gộp 2 đoạn bất thường cách nhau <= N step (mặc định 0)
    ECG_AI_MODEL_NAME/VERSION  chỉ để hiển thị ở /health

Không resample: mỗi dòng của tệp là 1 step, đúng đơn vị lúc train; `sampleRateHz` chỉ dùng đổi chỉ số step -> mili-giây.
"""
import hmac
import json
import logging
import os
import threading
import time

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

from service import postprocess as pp

log = logging.getLogger("ecg-ai")
logging.basicConfig(level=logging.INFO)

BUNDLE_PATH = os.getenv("ECG_BUNDLE_PATH", "checkpoints/ECG_wsize100_deploy.pt")
API_KEY = (os.getenv("ECG_AI_API_KEY") or "").strip() or None
DEVICE = os.getenv("ECG_AI_DEVICE", "cpu")
SEVERITY = os.getenv("ECG_AI_SEVERITY", "high")
MERGE_GAP = int(os.getenv("ECG_AI_MERGE_GAP_STEPS", "0"))
DEFAULT_NORM_THRESHOLD = 0.5          # ≡ đúng ngưỡng calibrate trong bundle

app = FastAPI(title="ECG anomaly AI service", version="1.0")
_state = {"detector": None, "error": None}
_lock = threading.Lock()              # Detector.score đặt seed RNG toàn cục -> không chạy song song


@app.on_event("startup")
def _load():
    try:
        from utils.deploy import load_bundle
        det = load_bundle(BUNDLE_PATH, device=DEVICE)
        if det.threshold is None:
            raise RuntimeError("Bundle chưa có ngưỡng (calibration.threshold)")
        _state["detector"] = det
        log.info("Đã nạp bundle %s: win_size=%d, kênh=%d, ngưỡng=%.6f", BUNDLE_PATH, det.win_size, det.n_features, det.threshold)
    except Exception as e:  # noqa: BLE001 — service vẫn lên, /health báo lỗi, backend nhận 503 -> analysis 'failed'
        _state["error"] = f"{type(e).__name__}: {e}"
        log.error("Không nạp được bundle %s: %s", BUNDLE_PATH, _state["error"])


def _auth(authorization):
    if API_KEY is None:
        return
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token, API_KEY):
        raise HTTPException(status_code=401, detail="API key không hợp lệ")


@app.get("/health")
def health():
    det = _state["detector"]
    if det is None:
        raise HTTPException(status_code=503, detail={"status": "model_not_loaded", "error": _state["error"], "bundle": BUNDLE_PATH})
    return {"status": "ok", "model": os.getenv("ECG_AI_MODEL_NAME", "tcn-vae-diff"), "version": os.getenv("ECG_AI_MODEL_VERSION", "1.0.0"),
            "winSize": det.win_size, "numLeads": det.n_features, "bundleThreshold": det.threshold,
            "calibration": {k: det.calibration.get(k) for k in ("percentile", "stride")}}


@app.post("/v1/ecg/analyze")
def analyze(metadata: str = Form(...), signal: UploadFile = File(...), authorization: str | None = Header(default=None)):
    _auth(authorization)
    det = _state["detector"]
    if det is None:
        raise HTTPException(status_code=503, detail=f"Model chưa sẵn sàng: {_state['error']}")

    try:
        meta = json.loads(metadata)
        fs = float(meta["sampleRateHz"])
        fmt = str(meta["signalFormat"]).lower()
        lead_names = meta.get("leadNames") or []
        n_leads = int(meta.get("numLeads", det.n_features))
        opts = meta.get("options") or {}
        if fs <= 0:
            raise ValueError("sampleRateHz phải > 0")
    except (json.JSONDecodeError, KeyError, ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"metadata không hợp lệ: {e}")

    norm_thr = opts.get("threshold", DEFAULT_NORM_THRESHOLD)
    if not isinstance(norm_thr, (int, float)) or not 0.0 <= norm_thr < 1.0:
        raise HTTPException(status_code=422, detail="options.threshold phải trong [0, 1)")

    if n_leads != det.n_features:
        return pp.non_decision_result("inconclusive", f"bản ghi có {n_leads} kênh, model cần {det.n_features}")

    try:
        x = pp.parse_signal(signal.file.read(), fmt, det.n_features, lead_names)
    except pp.SignalFormatError as e:
        raise HTTPException(status_code=422, detail=str(e))

    quality, bad = pp.check_quality(x)
    if bad:
        return pp.non_decision_result("poor_signal", bad, quality)
    if len(x) < det.win_size:
        return pp.non_decision_result("inconclusive", f"tín hiệu {len(x)} step < win_size {det.win_size}", quality)

    t0 = time.perf_counter()
    try:
        with _lock:
            scores = det.score(x, nan_policy="interpolate")
    except Exception as e:  # noqa: BLE001
        log.exception("Suy luận lỗi")
        raise HTTPException(status_code=500, detail=f"Lỗi suy luận: {type(e).__name__}: {e}")
    latency = int((time.perf_counter() - t0) * 1000)

    stride = int(det.calibration.get("stride") or det.win_size)
    return pp.build_result(scores, det.threshold, float(norm_thr), fs, det.win_size, stride,
                           lead_names or [f"ch{i + 1}" for i in range(n_leads)],
                           severity=SEVERITY, merge_gap=MERGE_GAP, signal_quality=quality, latency_ms=latency)
