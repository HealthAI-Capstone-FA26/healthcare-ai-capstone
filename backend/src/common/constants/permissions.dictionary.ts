// 1. DEFINITIONS: Enum Tài nguyên (map chuẩn theo danh sách Module), Action và Scope
export enum Resource {
    ALLERGY = 'allergy',
    CARE_PLAN = 'care-plan',
    CLAIM = 'claim',
    CLAIMS_TRANSACTION = 'claims-transaction',
    CONDITION = 'condition',
    DEVICE = 'device',
    ENCOUNTER = 'encounter',
    IMAGING_STUDY = 'imaging-study',
    IMMUNIZATION = 'immunization',
    MEDICATION = 'medication',
    OBSERVATION = 'observation',
    ORGANIZATION = 'organization',
    PATIENT = 'patient',
    PAYER = 'payer',
    PAYER_TRANSITION = 'payer-transition',
    PROCEDURE = 'procedure',
    PROVIDER = 'provider',
    SUPPLY = 'supply',
}

export enum Action {
    CREATE = 'create',
    READ = 'read',
    UPDATE = 'update',
    DELETE = 'delete',
}

export enum Scope {
    // cần xem xét lại có bao nhiêu scope
    OWN = 'own',
    GROUP = 'group',
    ALL = 'all',
}

export interface PermissionItem {
    code: string;
    description: string;
}

// 2. HELPER: Hàm render description tĩnh theo mẫu
const buildDescription = (resource: string, action: string, scope: string): string => {
    return `Đây là quyền cho phép 1 đối tượng thuộc scope '${scope}' thực hiện hành động '${action}' vào tài nguyên '${resource}'`;
};

// 3. DICTIONARY GENERATOR: Tự động quét 3 vòng lặp để sinh tất cả các permission
export const PERMISSIONS_DICTIONARY: PermissionItem[] = Object.values(Resource).flatMap(
    (resource) =>
        Object.values(Action).flatMap((action) =>
            Object.values(Scope).map((scope) => ({
                code: `${resource}:${action}:${scope}`,
                description: buildDescription(resource, action, scope),
            })),
        ),
);