"""
Quy tắc bắt buộc:
- core/ranker, core/retriever, core/llm CHỈ được import và sử dụng các class trong file này.
- adapters/mimic/* và (phía Node) prisma-adapter.ts PHẢI tạo ra đúng object theo class ở đây.
- KHÔNG được sửa file này sau khi đã có checkpoint (v1.0.0 trở đi) — mọi thay đổi field
  đều coi là breaking change, phải bump major version của canonical schema.
"""

from __future__ import annotations
from datetime import date, datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Thành phần dùng chung cho cả 2 giai đoạn
# ---------------------------------------------------------------------------

class PatientDemographics(BaseModel):
    """Bắt buộc để tính alert threshold (age/gender-based) và cho ranker similarity."""
    age_years: int = Field(..., ge=0, le=120)
    gender: Literal["male", "female", "other", "unknown"]


class VitalSignObservation(BaseModel):
    """
    1 giá trị sinh hiệu đo được.
    - MIMIC nguồn: ed.vitalsign (mỗi cột HR/RR/SpO2/Temp/SBP... → 1 record)
    - Prisma nguồn: VitalSignObservation join VitalSignItem
    """
    item_code: str                     # khớp VitalSignItem.itemCode
    loinc_code: Optional[str] = None   # khớp VitalSignItem.loincCode — khóa nối chuẩn hóa với MIMIC
    value: float
    unit: str
    is_abnormal: bool = False


class AlertFlag(BaseModel):
    """
    1 cảnh báo bất thường (từ vital sign hoặc lab), đã được tính sẵn theo threshold.
    - MIMIC nguồn: PHẢI tự tính bằng core/alerts/rules.py (MIMIC không có sẵn field này).
    - Prisma nguồn: VitalSignAlert / LabResultAlert (đã có sẵn field alertLevel/riskLevel).
    QUAN TRỌNG: logic sinh ra AlertFlag ở 2 nguồn phải dùng chung 1 hàm compute_alert()
    trong core/alerts/rules.py — không được viết 2 phiên bản logic khác nhau.
    """
    source_item_code: str              # item_code (vital) hoặc parameter_code (lab) gây ra alert
    loinc_code: Optional[str] = None
    alert_level: Literal["normal", "abnormal", "critical"]
    measured_value: float
    expected_min: Optional[float] = None
    expected_max: Optional[float] = None
    reason: Optional[str] = None


class LabValue(BaseModel):
    """
    1 kết quả xét nghiệm.
    - MIMIC nguồn: hosp.labevents join hosp.d_labitems
    - Prisma nguồn: LabResultValue join LabResultParameter
    """
    parameter_code: str                # khớp LabResultParameter.parameterCode
    loinc_code: Optional[str] = None   # khớp LabResultParameter.loincCode
    value_numeric: Optional[float] = None
    value_text: Optional[str] = None
    unit: Optional[str] = None
    is_abnormal: bool = False


# ---------------------------------------------------------------------------
# Stage 1 — Chẩn đoán sơ bộ (trước xét nghiệm)
# ---------------------------------------------------------------------------

class CanonicalStage1(BaseModel):
    """
    Input đầy đủ cho pipeline Giai đoạn 1.
    encounter_id: định danh duy nhất của lượt khám (dùng để trace ngược, KHÔNG dùng làm feature).
    """
    encounter_id: str
    demographics: PatientDemographics
    chief_complaint_text: str          # ChiefComplaint.symptoms + reasonForVisit / ed.triage.chiefcomplaint
    pain_level: Optional[int] = Field(default=None, ge=0, le=10)
    symptom_onset_date: Optional[date] = None
    vital_signs: list[VitalSignObservation] = Field(default_factory=list)
    alerts: list[AlertFlag] = Field(default_factory=list)
    clinical_note_text: Optional[str] = None   # ClinicalExamination.examinationFindings/clinicalNotes
    recorded_at: datetime


# ---------------------------------------------------------------------------
# Stage 2 — Chẩn đoán sau xét nghiệm (kế thừa Stage 1, bổ sung lab)
# ---------------------------------------------------------------------------

class CanonicalStage2(BaseModel):
    """Input đầy đủ cho pipeline Giai đoạn 2 — bao gồm toàn bộ Stage 1 cộng dữ liệu lab."""
    stage1: CanonicalStage1
    lab_values: list[LabValue] = Field(default_factory=list)
    lab_alerts: list[AlertFlag] = Field(default_factory=list)
    provisional_icd10_codes: list[str] = Field(default_factory=list)  # kết quả Stage 1, dùng làm proxy cho τ_Diag


# ---------------------------------------------------------------------------
# Output — đúng theo shape của AiDiagnosisSuggestion / AiReferenceSource trong Prisma
# ---------------------------------------------------------------------------

class DiagnosisSuggestion(BaseModel):
    icd10_code: str
    suggested_diag_name: str
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    rank: int = Field(..., ge=1)
    source_type: Literal["initial_summary", "lab_analysis"]  # initial_summary=Stage1, lab_analysis=Stage2
    explanation_text: Optional[str] = None
    model_name: str
    model_version: str


class ReferenceSource(BaseModel):
    """1 bệnh nhân tương tự được ExpRAG dùng làm bằng chứng cho 1 DiagnosisSuggestion."""
    source_encounter_id: str
    relevance_note: Optional[str] = None


class DiagnosisResult(BaseModel):
    """Output cuối cùng của pipeline — trả về cho service/ để lưu vào DB."""
    encounter_id: str
    suggestions: list[DiagnosisSuggestion]
    references: list[ReferenceSource]
