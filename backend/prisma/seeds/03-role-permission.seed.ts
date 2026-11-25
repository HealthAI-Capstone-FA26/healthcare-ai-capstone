import { PrismaService } from 'prisma/prisma.service';
import { ACTOR_ROLE } from '../../src/common/constants/actor-role.constant';
import {
    Action,
    PERMISSIONS_DICTIONARY,
    Resource,
    Scope,
} from '../../src/common/constants/permissions.dictionary';

/**
 * Gán permission (resource:action:scope) cho từng role. PHẢI chạy SAU 01-role và 02-permission.
 *
 * Quy tắc scope (xem src/common/utils/permission.util.ts): all(3) >= group(2) >= own(1) — có scope rộng hơn
 * thì tự qua được route yêu cầu scope hẹp hơn, nên mỗi role chỉ cần gán scope CAO NHẤT mà route của nó yêu cầu.
 *   - own   : chỉ dữ liệu của chính mình (bệnh nhân, thao tác tài khoản cá nhân)
 *   - group : nhân viên nghiệp vụ (lễ tân, điều dưỡng, kỹ thuật viên, bác sĩ)
 *   - all   : toàn hệ thống (admin; vài API lễ tân như thu tiền, đổi trạng thái lịch hẹn)
 *
 * Seed chỉ THÊM (skipDuplicates), không xoá quyền đã gán tay qua API /admin/roles/:id/permissions.
 */

type Grant = { resource: Resource; actions: Action[]; scope: Scope };

const { CREATE, READ, UPDATE, DELETE } = Action;
const CRU = [CREATE, READ, UPDATE];
const CRUD = [CREATE, READ, UPDATE, DELETE];

const grant = (resource: Resource, actions: Action[], scope: Scope): Grant => ({ resource, actions, scope });

// Quyền cơ bản cho MỌI role đã đăng nhập: tài khoản cá nhân, thông báo, ETA hàng đợi, danh sách permission.
const COMMON_GRANTS: Grant[] = [
    grant(Resource.USER, [READ, UPDATE], Scope.OWN), // logout, change-password, /users/me, /notifications*
    grant(Resource.ROLE, [READ], Scope.OWN), // GET /admin/permissions
    grant(Resource.ORGANIZATION, [READ], Scope.OWN), // GET /statistics/eta*
    grant(Resource.DOCTOR_SCHEDULE, [READ], Scope.OWN),
    grant(Resource.APPOINTMENT_SLOT, [READ], Scope.GROUP), // xem slot trống khi đặt lịch
    grant(Resource.CONSENT_POLICY, [READ], Scope.GROUP),
];

const ROLE_GRANTS: Record<string, Grant[]> = {
    [ACTOR_ROLE.PATIENT]: [
        grant(Resource.PATIENT, CRU, Scope.OWN),
        grant(Resource.APPOINTMENT, CRU, Scope.OWN), // đặt / xem / đổi / huỷ lịch của mình
        grant(Resource.INVOICE, [READ], Scope.OWN),
        grant(Resource.PAYMENT, [CREATE, READ], Scope.OWN), // tự thanh toán PayOS
        grant(Resource.PRESCRIPTION, [READ], Scope.OWN),
    ],

    [ACTOR_ROLE.RECEPTIONIST]: [
        grant(Resource.PATIENT, CRU, Scope.GROUP),
        grant(Resource.APPOINTMENT, CRU, Scope.GROUP),
        grant(Resource.APPOINTMENT, [UPDATE], Scope.ALL), // sync-patient / confirm / no-show / cancel
        grant(Resource.QUEUE_TICKET, [READ], Scope.GROUP),
        grant(Resource.QUEUE_TICKET, [UPDATE], Scope.ALL), // gọi số / kết thúc lượt gọi
        grant(Resource.ENCOUNTER, CRU, Scope.GROUP),
        grant(Resource.CHIEF_COMPLAINT, [CREATE, READ], Scope.GROUP),
        grant(Resource.IDENTITY_VERIFICATION, [CREATE, READ], Scope.GROUP),
        grant(Resource.CONSENT, CRU, Scope.GROUP),
        grant(Resource.DOCTOR_QUEUE_ENTRY, [READ], Scope.GROUP),
        grant(Resource.INVOICE, CRU, Scope.ALL),
        grant(Resource.PAYMENT, [CREATE, UPDATE], Scope.ALL), // thu tiền mặt / xác nhận đối soát
        grant(Resource.PAYMENT, [READ], Scope.GROUP),
    ],

    [ACTOR_ROLE.NURSE]: [
        grant(Resource.PATIENT, [READ], Scope.GROUP),
        grant(Resource.ENCOUNTER, [READ, UPDATE], Scope.GROUP), // route-doctor, xem lượt khám
        grant(Resource.CHIEF_COMPLAINT, [READ], Scope.GROUP),
        grant(Resource.DOCTOR_QUEUE_ENTRY, [READ, UPDATE], Scope.GROUP), // triage queue
        grant(Resource.OBSERVATION, CRU, Scope.GROUP), // ghi nhận sinh hiệu
        grant(Resource.PROCEDURE, [READ], Scope.GROUP),
        grant(Resource.MEDICATION, [READ], Scope.GROUP),
        grant(Resource.ALLERGY, [READ], Scope.ALL),
        grant(Resource.CONDITION, [READ], Scope.ALL),
    ],j

    [ACTOR_ROLE.LAB_STAFF]: [
        grant(Resource.PATIENT, [READ], Scope.GROUP),
        grant(Resource.ENCOUNTER, [READ, UPDATE], Scope.GROUP),
        grant(Resource.ORGANIZATION, [READ], Scope.GROUP), // danh sách phòng Lab
        grant(Resource.PROCEDURE, [READ, UPDATE], Scope.GROUP), // lab task
        grant(Resource.OBSERVATION, CRUD, Scope.GROUP), // kết quả xét nghiệm, ECG, cảnh báo
    ],

    [ACTOR_ROLE.DOCTOR]: [
        grant(Resource.APPOINTMENT, [READ], Scope.GROUP),
        grant(Resource.APPOINTMENT, [UPDATE], Scope.OWN), // bắt đầu / hoàn tất khám
        grant(Resource.PATIENT, [READ], Scope.GROUP),
        grant(Resource.ENCOUNTER, [READ, UPDATE], Scope.GROUP),
        grant(Resource.CHIEF_COMPLAINT, [READ], Scope.GROUP),
        grant(Resource.DOCTOR_QUEUE_ENTRY, [READ, UPDATE], Scope.GROUP),
        grant(Resource.CONDITION, CRUD, Scope.GROUP), // chẩn đoán
        grant(Resource.CONDITION, CRU, Scope.ALL), // tiền sử bệnh
        grant(Resource.ALLERGY, CRU, Scope.ALL),
        grant(Resource.PROCEDURE, CRU, Scope.GROUP), // chỉ định xét nghiệm
        grant(Resource.OBSERVATION, CRU, Scope.GROUP),
        grant(Resource.CARE_PLAN, [READ, UPDATE], Scope.GROUP), // tư vấn điều trị / hẹn tái khám
        grant(Resource.MEDICATION, [READ], Scope.GROUP),
        grant(Resource.PRESCRIPTION, CRU, Scope.OWN),
    ],
};

export async function seedRolePermissions(prisma: PrismaService): Promise<void> {
    const validCodes = new Set(PERMISSIONS_DICTIONARY.map((item) => item.code));

    const expand = (grants: Grant[]): string[] => {
        const codes = new Set<string>();
        for (const { resource, actions, scope } of grants) {
            for (const action of actions) {
                const code = `${resource}:${action}:${scope}`;
                if (!validCodes.has(code)) {
                    throw new Error(`Permission '${code}' không có trong PERMISSIONS_DICTIONARY.`);
                }
                codes.add(code);
            }
        }
        return [...codes];
    };

    // ADMIN: toàn quyền — mọi resource, mọi action, scope all (all bao hàm group và own).
    const adminCodes = PERMISSIONS_DICTIONARY.filter((item) => item.code.endsWith(`:${Scope.ALL}`)).map(
        (item) => item.code,
    );

    const roles = await prisma.role.findMany();
    const permissions = await prisma.permission.findMany();
    const roleIdByCode = new Map(roles.map((r) => [r.roleCode, r.roleId]));
    const permissionIdByCode = new Map(permissions.map((p) => [p.permissionCode, p.permissionId]));

    const plan: Record<string, string[]> = {
        [ACTOR_ROLE.ADMIN]: adminCodes,
        ...Object.fromEntries(
            Object.entries(ROLE_GRANTS).map(([roleCode, grants]) => [roleCode, expand([...COMMON_GRANTS, ...grants])]),
        ),
    };

    for (const [roleCode, codes] of Object.entries(plan)) {
        const roleId = roleIdByCode.get(roleCode);
        if (!roleId) {
            throw new Error(`Không tìm thấy role '${roleCode}' — cần chạy 01-role.seed trước.`);
        }

        const data = codes.map((code) => {
            const permissionId = permissionIdByCode.get(code);
            if (!permissionId) {
                throw new Error(`Không tìm thấy permission '${code}' trong DB — cần chạy 02-permission.seed trước.`);
            }
            return { roleId, permissionId };
        });

        await prisma.rolePermission.createMany({ data, skipDuplicates: true });
        console.log(`Role ${roleCode}: gán ${data.length} permissions`);
    }
}
