"""
Logic tính AlertFlag — DÙNG CHUNG bắt buộc cho cả adapters/mimic/ và Prisma adapter (production).

Nguyên tắc: hàm ở đây KHÔNG được hardcode giá trị ngưỡng. Ngưỡng luôn được truyền vào
từ bên ngoài (đọc từ VitalSignThreshold/LabParameterThreshold ở Prisma, hoặc từ cùng
1 bộ threshold export ra file config dùng chung khi build tập train từ MIMIC).
Nếu 2 môi trường dùng 2 bộ giá trị threshold khác nhau, alert sẽ lệch nhau dù code
logic giống hệt — do đó bước tiếp theo (sau bước này) BẮT BUỘC phải là export threshold
thành 1 nguồn sự thật duy nhất.

Quy tắc khớp với schema thật:
- VitalSignAlert: chỉ 1 mức "critical" (ngoài khoảng minNormal/maxNormal là alert, không có tier).
- LabResultAlert: 5 mức risk_level (normal|low|medium|high|critical), mỗi mức có range riêng.
"""

from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel

from core.schema.canonical import AlertFlag, VitalSignObservation, LabValue


# ---------------------------------------------------------------------------
# Định nghĩa threshold — mirror đúng field của VitalSignThreshold / LabParameterThreshold
# ---------------------------------------------------------------------------

class VitalThresholdDef(BaseModel):
    """Mirror VitalSignThreshold. min/maxNormal là khoảng bình thường; ra ngoài = critical."""
    item_code: str
    age_min: Optional[int] = None
    age_max: Optional[int] = None
    gender: Optional[Literal["male", "female"]] = None
    min_normal: float
    max_normal: float
    is_active: bool = True


class LabThresholdDef(BaseModel):
    """Mirror LabParameterThreshold. Mỗi row là 1 tier risk_level với range riêng."""
    parameter_code: str
    age_min: Optional[int] = None
    age_max: Optional[int] = None
    gender: Optional[Literal["male", "female"]] = None
    risk_level: Literal["normal", "low", "medium", "high", "critical"]
    range_min: Optional[float] = None
    range_max: Optional[float] = None
    is_active: bool = True


# ---------------------------------------------------------------------------
# Chọn threshold áp dụng — ưu tiên bản ghi CỤ THỂ hơn (có age range + gender riêng)
# hơn bản ghi tổng quát (age/gender = null, áp dụng cho tất cả)
# ---------------------------------------------------------------------------

def _specificity_score(age_min, age_max, gender) -> int:
    score = 0
    if age_min is not None or age_max is not None:
        score += 1
    if gender is not None:
        score += 1
    return score


def _matches_patient(age_min, age_max, gender, patient_age: int, patient_gender: str) -> bool:
    if age_min is not None and patient_age < age_min:
        return False
    if age_max is not None and patient_age > age_max:
        return False
    if gender is not None and gender != patient_gender:
        return False
    return True


def _select_vital_threshold(
    thresholds: list[VitalThresholdDef], item_code: str, age: int, gender: str
) -> Optional[VitalThresholdDef]:
    candidates = [
        t for t in thresholds
        if t.item_code == item_code and t.is_active
        and _matches_patient(t.age_min, t.age_max, t.gender, age, gender)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda t: _specificity_score(t.age_min, t.age_max, t.gender))


def _select_lab_thresholds(
    thresholds: list[LabThresholdDef], parameter_code: str, age: int, gender: str
) -> list[LabThresholdDef]:
    """Trả về TẤT CẢ tier áp dụng cho bệnh nhân (vì cần dò value rơi vào tier nào)."""
    return [
        t for t in thresholds
        if t.parameter_code == parameter_code and t.is_active
        and _matches_patient(t.age_min, t.age_max, t.gender, age, gender)
    ]


# ---------------------------------------------------------------------------
# Hàm chính — đây là 2 hàm mà cả MIMIC adapter và Prisma adapter phải gọi chung
# ---------------------------------------------------------------------------

def compute_vital_alert(
    observation: VitalSignObservation,
    age_years: int,
    gender: str,
    thresholds: list[VitalThresholdDef],
) -> Optional[AlertFlag]:
    """
    Trả về AlertFlag nếu giá trị NẰM NGOÀI [min_normal, max_normal] của threshold áp dụng.
    Trả về None nếu bình thường HOẶC không tìm thấy threshold áp dụng (không đủ căn cứ để báo động).
    """
    threshold = _select_vital_threshold(thresholds, observation.item_code, age_years, gender)
    if threshold is None:
        return None

    if threshold.min_normal <= observation.value <= threshold.max_normal:
        return None  # bình thường, KHÔNG tạo alert (khớp hành vi thật: chỉ lưu row khi bất thường)

    return AlertFlag(
        source_item_code=observation.item_code,
        loinc_code=observation.loinc_code,
        alert_level="critical",  # VitalSignAlert chỉ có 1 tier
        measured_value=observation.value,
        expected_min=threshold.min_normal,
        expected_max=threshold.max_normal,
        reason=f"{observation.item_code} ngoài khoảng bình thường "
               f"[{threshold.min_normal}, {threshold.max_normal}] {observation.unit}",
    )


def compute_lab_alert(
    lab_value: LabValue,
    age_years: int,
    gender: str,
    thresholds: list[LabThresholdDef],
) -> Optional[AlertFlag]:
    """
    Trả về AlertFlag nếu giá trị rơi vào 1 tier risk_level KHÁC "normal".
    Trả về None nếu rơi vào tier "normal" HOẶC không có giá trị numeric để so sánh
    HOẶC không tìm thấy threshold áp dụng.
    """
    if lab_value.value_numeric is None:
        return None  # dataType positive_negative/text — ngoài phạm vi hàm này

    applicable = _select_lab_thresholds(thresholds, lab_value.parameter_code, age_years, gender)
    if not applicable:
        return None

    matched_tier = None
    for t in applicable:
        lo = t.range_min if t.range_min is not None else float("-inf")
        hi = t.range_max if t.range_max is not None else float("inf")
        if lo <= lab_value.value_numeric <= hi:
            matched_tier = t
            break

    if matched_tier is None or matched_tier.risk_level == "normal":
        return None

    return AlertFlag(
        source_item_code=lab_value.parameter_code,
        loinc_code=lab_value.loinc_code,
        alert_level="critical" if matched_tier.risk_level == "critical" else "abnormal",
        measured_value=lab_value.value_numeric,
        expected_min=matched_tier.range_min,
        expected_max=matched_tier.range_max,
        reason=f"{lab_value.parameter_code} rơi vào mức {matched_tier.risk_level} "
               f"[{matched_tier.range_min}, {matched_tier.range_max}]",
    )
