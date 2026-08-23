// Convention: PatientContact.relationship là VarChar tự do. Thay vì thêm cột
// `status`, ta đánh dấu trạng thái "chờ duyệt" bằng prefix `pending:` ngay trong
// giá trị relationship (ví dụ 'pending:parent'). Giá trị "sạch" (không prefix)
// mới được coi là contact hợp lệ (đã duyệt / tự đủ điều kiện).
export const PENDING_RELATIONSHIP_PREFIX = 'pending:';

export function isPendingRelationship(relationship: string): boolean {
  return relationship.startsWith(PENDING_RELATIONSHIP_PREFIX);
}

export function toPendingRelationship(relationship: string): string {
  return `${PENDING_RELATIONSHIP_PREFIX}${relationship}`;
}

// Bỏ prefix `pending:` để lấy lại giá trị relationship gốc (self|parent|child|spouse|guardian|other).
// Nếu relationship truyền vào vốn đã "sạch" thì trả về nguyên trạng.
export function stripPendingPrefix(relationship: string): string {
  return isPendingRelationship(relationship)
    ? relationship.slice(PENDING_RELATIONSHIP_PREFIX.length)
    : relationship;
}
