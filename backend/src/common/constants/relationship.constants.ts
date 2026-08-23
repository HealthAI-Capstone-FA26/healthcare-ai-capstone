// Quan hệ giữa user đang thao tác và patient — dùng chung cho đặt lịch (Phase 4/5)
// và yêu cầu làm người thân (Contact Request). Giá trị khớp với comment trên
// cột PatientContact.relationship trong schema.prisma.

// Dùng khi đặt lịch: cho phép cả 'self' (đặt cho chính mình).
export enum RelationshipType {
  SELF = 'self',
  PARENT = 'parent',
  CHILD = 'child',
  SPOUSE = 'spouse',
  GUARDIAN = 'guardian',
  OTHER = 'other',
}

// Dùng khi gửi yêu cầu làm người thân (Contact Request): không cho chọn 'self'
// vì self chỉ được xác lập qua Phase 1 (linkUser), không qua xin duyệt.
export enum NonSelfRelationshipType {
  PARENT = 'parent',
  CHILD = 'child',
  SPOUSE = 'spouse',
  GUARDIAN = 'guardian',
  OTHER = 'other',
}
