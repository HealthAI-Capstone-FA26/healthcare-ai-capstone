import { NotFoundException } from '@nestjs/common';
import { AdminRbacService } from '../../src/modules/identity-access/auth/role-permission/role-permission.service';

describe('AdminRbacService (F-02 RBAC)', () => {
  let service: AdminRbacService;
  let prisma: any;

  const permA = { permissionId: 'p-1', permissionCode: 'patient.read' };
  const permB = { permissionId: 'p-2', permissionCode: 'patient.write' };
  const doctorRole = { roleId: 'r-doc', roleCode: 'DOCTOR  ', roleName: 'Bác sĩ' };

  beforeEach(() => {
    prisma = {
      permission: { findMany: jest.fn() },
      role: { findMany: jest.fn(), findUnique: jest.fn() },
      rolePermission: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      user: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    service = new AdminRbacService(prisma);
  });

  it('listAllPermissions: trả danh sách permission sắp theo permissionCode', async () => {
    prisma.permission.findMany.mockResolvedValue([permA, permB]);
    const res = await service.listAllPermissions();
    expect(prisma.permission.findMany).toHaveBeenCalledWith({ orderBy: { permissionCode: 'asc' } });
    expect(res).toEqual([permA, permB]);
  });

  it('listRolesWithPermissions: trim roleCode khi trả danh sách role', async () => {
    prisma.role.findMany.mockResolvedValue([
      { ...doctorRole, rolePermissions: [{ permission: permA }] },
    ]);

    const res = await service.listRolesWithPermissions();
    expect(res[0].roleCode).toBe('DOCTOR');
  });

  it('getRolePermissions: ném NotFoundException nếu role không tồn tại', async () => {
    prisma.role.findUnique.mockResolvedValue(null);
    await expect(service.getRolePermissions('missing-role')).rejects.toThrow(NotFoundException);
  });

  it('addPermissionsToRole: thêm permissions (skipDuplicates) và trả danh sách mới', async () => {
    prisma.role.findUnique
      .mockResolvedValueOnce(doctorRole)
      .mockResolvedValueOnce({ ...doctorRole, rolePermissions: [{ permission: permA }, { permission: permB }] });
    prisma.permission.findMany.mockResolvedValue([{ permissionId: 'p-1' }, { permissionId: 'p-2' }]);
    prisma.rolePermission.createMany.mockResolvedValue({ count: 2 });

    const res = await service.addPermissionsToRole('r-doc', ['p-1', 'p-2']);

    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [
        { roleId: 'r-doc', permissionId: 'p-1' },
        { roleId: 'r-doc', permissionId: 'p-2' },
      ],
      skipDuplicates: true,
    });
    expect(res).toEqual([permA, permB]);
  });

  it('addPermissionsToRole: ném NotFoundException khi có permissionId không tồn tại', async () => {
    prisma.role.findUnique.mockResolvedValue(doctorRole);
    prisma.permission.findMany.mockResolvedValue([{ permissionId: 'p-1' }]);

    await expect(service.addPermissionsToRole('r-doc', ['p-1', 'p-missing'])).rejects.toThrow(
      new NotFoundException('Không tìm thấy permission(s): p-missing'),
    );
  });

  it('replaceRolePermissions: chạy transaction xoá hết cũ và tạo lại permissions mới', async () => {
    prisma.role.findUnique
      .mockResolvedValueOnce(doctorRole)
      .mockResolvedValueOnce({ ...doctorRole, rolePermissions: [{ permission: permB }] });
    prisma.permission.findMany.mockResolvedValue([{ permissionId: 'p-2' }]);
    prisma.rolePermission.deleteMany.mockResolvedValue({ count: 1 });
    prisma.rolePermission.createMany.mockResolvedValue({ count: 1 });

    const res = await service.replaceRolePermissions('r-doc', ['p-2']);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'r-doc' } });
    expect(res).toEqual([permB]);
  });

  it('removePermissionFromRole: ném NotFoundException nếu role chưa có permission đó', async () => {
    prisma.role.findUnique.mockResolvedValue(doctorRole);
    prisma.rolePermission.findUnique.mockResolvedValue(null);

    await expect(service.removePermissionFromRole('r-doc', 'p-2')).rejects.toThrow(NotFoundException);
  });

  it('removePermissionFromRole: xoá permission khỏi role thành công', async () => {
    prisma.role.findUnique
      .mockResolvedValueOnce(doctorRole)
      .mockResolvedValueOnce({ ...doctorRole, rolePermissions: [{ permission: permA }] });
    prisma.rolePermission.findUnique.mockResolvedValue({ roleId: 'r-doc', permissionId: 'p-2' });
    prisma.rolePermission.delete.mockResolvedValue({});

    const res = await service.removePermissionFromRole('r-doc', 'p-2');

    expect(prisma.rolePermission.delete).toHaveBeenCalledWith({
      where: { roleId_permissionId: { roleId: 'r-doc', permissionId: 'p-2' } },
    });
    expect(res).toEqual([permA]);
  });

  it('getUserRole: trả role hiện tại của user hoặc ném NotFoundException nếu thiếu user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.getUserRole('missing-u')).rejects.toThrow(NotFoundException);

    prisma.user.findUnique.mockResolvedValueOnce({ userId: 'u-1', role: doctorRole });
    const role = await service.getUserRole('u-1');
    expect(role).toEqual(doctorRole);
  });

  it('assignRoleToUser: gán role mới cho user và bỏ qua update nếu đã cùng roleId', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ userId: 'u-1', roleId: 'r-old' });
    prisma.role.findUnique.mockResolvedValueOnce(doctorRole);
    prisma.user.update.mockResolvedValueOnce({ userId: 'u-1', roleId: 'r-doc' });

    const assigned = await service.assignRoleToUser('u-1', 'r-doc');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      data: { roleId: 'r-doc' },
    });
    expect(assigned).toEqual(doctorRole);

    prisma.user.findUnique.mockResolvedValueOnce({ userId: 'u-1', roleId: 'r-doc' });
    prisma.role.findUnique.mockResolvedValueOnce(doctorRole);
    await service.assignRoleToUser('u-1', 'r-doc');
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
});
