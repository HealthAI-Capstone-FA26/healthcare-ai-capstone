import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { pickLeastLoaded } from '../../../common/utils/least-loaded.util';
import { EncounterDepartmentRoutingService } from './encounter-department-routing.service';

// ───────────── DB giả lập trong bộ nhớ (đủ các phương thức Prisma mà service dùng) ─────────────
const NOW = new Date(Date.UTC(2026, 8, 21, 10, 0, 0)); // "giờ tường" bệnh viện: 21/09/2026 10:00
const TODAY = new Date(Date.UTC(2026, 8, 21));
const time = (h: number, m = 0) => new Date(Date.UTC(1970, 0, 1, h, m));
const DEPT_OLD = 'dept-old';
const DEPT_NEW = 'dept-new';

interface Opts { lock?: boolean }
function makeDb(opts: Opts = {}) {
  const useLock = opts.lock !== false;
  const st = {
    encounters: new Map<string, any>(),
    appointments: new Map<string, any>(),
    vitals: new Map<string, number>(),
    departments: new Map<string, any>([
      [DEPT_OLD, { departmentId: DEPT_OLD, departmentName: 'Khoa Cũ', isActive: true }],
      [DEPT_NEW, { departmentId: DEPT_NEW, departmentName: 'Khoa Mới', isActive: true }],
    ]),
    doctors: new Map<string, any>(),
    schedules: [] as any[],
    entries: [] as any[],
    nextEntryId: 1,
  };
  const locks = new Map<string, Promise<void>>();

  const addDoctor = (id: string, depts: string[], shift: [number, number] = [7, 11.5], active = true) => {
    st.doctors.set(id, { doctorId: id, doctorCode: id.toUpperCase(), fullName: `BS ${id}`, title: 'BS', isActive: active, depts });
    for (const d of depts)
      st.schedules.push({ doctorId: id, departmentId: d, workDate: TODAY, status: 'active', startTime: time(Math.floor(shift[0]), (shift[0] % 1) * 60), endTime: time(Math.floor(shift[1]), (shift[1] % 1) * 60) });
  };
  const addEncounter = (id: string, o: any = {}) => {
    st.encounters.set(id, { encounterId: id, appointmentId: 'ap-' + id, departmentId: DEPT_OLD, doctorId: 'old-doc', status: 'registered', ...o });
    st.appointments.set('ap-' + id, { appointmentId: 'ap-' + id, priority: o.priority ?? 'normal', departmentId: DEPT_OLD, doctorId: 'old-doc', slotId: 'slot-1' });
    st.vitals.set(id, o.vitals ?? 1);
  };
  const addEntry = (o: any) => { const e = { queueEntryId: 'qe' + st.nextEntryId++, priority: 'normal', calledAt: null, examStartedAt: null, ...o }; st.entries.push(e); return e; };

  const build = (held: (() => void)[]) => ({
    $executeRaw: async (_s: TemplateStringsArray, key: string) => {
      if (!useLock) return 0;
      const prev = locks.get(key) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((r) => (release = r));
      locks.set(key, prev.then(() => mine));
      await prev;
      held.push(release);
      return 0;
    },
    encounter: {
      findUnique: async ({ where }: any) => {
        const e = st.encounters.get(where.encounterId);
        if (!e) return null;
        await Promise.resolve();
        return { ...e, appointment: { priority: st.appointments.get(e.appointmentId).priority }, doctorQueueEntry: st.entries.find((x) => x.encounterId === e.encounterId) ?? null };
      },
      update: async ({ where, data }: any) => Object.assign(st.encounters.get(where.encounterId), data),
    },
    vitalSignSession: { count: async ({ where }: any) => st.vitals.get(where.encounterId) ?? 0 },
    department: { findUnique: async ({ where }: any) => st.departments.get(where.departmentId) ?? null },
    doctorSchedule: {
      findMany: async ({ where }: any) => {
        await Promise.resolve();
        return st.schedules.filter((s) => {
          const d = st.doctors.get(s.doctorId);
          return s.departmentId === where.departmentId && s.workDate.getTime() === where.workDate.getTime() && s.status === where.status &&
            d.isActive === where.doctor.isActive && d.depts.includes(where.doctor.doctorDepartments.some.departmentId);
        });
      },
    },
    doctorQueueEntry: {
      groupBy: async ({ where }: any) => {
        await Promise.resolve();
        const m = new Map<string, number>();
        for (const e of st.entries)
          if (where.doctorId.in.includes(e.doctorId) && e.doctorQueueDate.getTime() === where.doctorQueueDate.getTime() &&
              where.status.in.includes(e.status) && e.encounterId !== where.encounterId.not)
            m.set(e.doctorId, (m.get(e.doctorId) ?? 0) + 1);
        return [...m].map(([doctorId, n]) => ({ doctorId, _count: { _all: n } }));
      },
      aggregate: async ({ where }: any) => {
        await Promise.resolve();
        const orders = st.entries.filter((e) => e.departmentId === where.departmentId && e.doctorQueueDate.getTime() === where.doctorQueueDate.getTime()).map((e) => e.queueOrder);
        return { _max: { queueOrder: orders.length ? Math.max(...orders) : null } };
      },
      create: async ({ data }: any) => {
        if (st.entries.some((e) => e.departmentId === data.departmentId && e.doctorQueueDate.getTime() === data.doctorQueueDate.getTime() && e.queueOrder === data.queueOrder))
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        return addEntry(data);
      },
      update: async ({ where, data }: any) => Object.assign(st.entries.find((e) => e.encounterId === where.encounterId), data),
    },
    appointment: { update: async ({ where, data }: any) => Object.assign(st.appointments.get(where.appointmentId), data) },
    doctor: { findUniqueOrThrow: async ({ where }: any) => { const d = st.doctors.get(where.doctorId); return { doctorId: d.doctorId, doctorCode: d.doctorCode, fullName: d.fullName, title: d.title }; } },
  });

  const prisma = {
    $transaction: async (fn: any) => {
      const snapshot = structuredClone({ e: [...st.encounters], a: [...st.appointments], en: st.entries, n: st.nextEntryId });
      const held: (() => void)[] = [];
      try { return await fn(build(held)); }
      catch (err) {
        st.encounters = new Map(snapshot.e); st.appointments = new Map(snapshot.a); st.entries = snapshot.en; st.nextEntryId = snapshot.n; // rollback
        throw err;
      } finally { held.forEach((r) => r()); }
    },
  };
  return { st, prisma, addDoctor, addEncounter, addEntry };
}

class TestService extends EncounterDepartmentRoutingService {
  public forced: number[] = [];
  protected now() { return NOW; }
  protected randomIndex(n: number) { return this.forced.length ? this.forced.shift()! % n : Math.floor(Math.random() * n); }
}
const actor = (role = 'NURSE') => ({ assertActorRole: async (_u: string, allowed: string[]) => { if (!allowed.includes(role)) throw new ForbiddenException('role'); return role; } });
const svcOf = (db: ReturnType<typeof makeDb>, role = 'NURSE') => new TestService(db.prisma as any, actor(role) as any);
const entry = (o: any) => ({ departmentId: DEPT_NEW, doctorQueueDate: TODAY, status: 'waiting', ...o });
const loadOf = (db: ReturnType<typeof makeDb>, id: string) => db.st.entries.filter((e) => e.doctorId === id && ['waiting', 'called', 'in_progress'].includes(e.status)).length;

describe('pickLeastLoaded', () => {
  it('chọn người tải thấp nhất', () => {
    expect(pickLeastLoaded([{ id: 'a', load: 3 }, { id: 'b', load: 1 }, { id: 'c', load: 2 }])!.chosen.id).toBe('b');
  });
  it('hoà -> random trong nhóm hoà, KHÔNG bao giờ chọn người tải cao hơn', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickLeastLoaded([{ id: 'a', load: 1 }, { id: 'b', load: 1 }, { id: 'c', load: 5 }])!.chosen.id);
    expect([...seen].sort()).toEqual(['a', 'b']);
  });
  it('rỗng -> null; chỉ 1 người -> người đó', () => {
    expect(pickLeastLoaded([])).toBeNull();
    expect(pickLeastLoaded([{ load: 9 }])!.tiedCount).toBe(1);
  });
});

describe('đổi khoa + xếp bác sĩ', () => {
  it('chọn bác sĩ ít bệnh nhân chờ nhất và cập nhật đủ Encounter/Appointment/DoctorQueueEntry', async () => {
    const db = makeDb();
    ['a', 'b', 'c'].forEach((d) => db.addDoctor(d, [DEPT_NEW]));
    for (let i = 0; i < 2; i++) db.addEntry(entry({ encounterId: 'x' + i, doctorId: 'a', queueOrder: i + 1 }));
    db.addEntry(entry({ encounterId: 'y0', doctorId: 'c', queueOrder: 3 }));
    db.addEntry(entry({ encounterId: 'z0', doctorId: 'a', queueOrder: 4, status: 'done' })); // done không tính tải
    db.addEncounter('e1', { priority: 'urgent' });

    const r = await svcOf(db).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u1');

    expect(r.current.doctor.doctorId).toBe('b');
    expect(r.assignment.queueLoadBefore).toBe(0);
    expect(r.assignment.candidates).toEqual([{ doctorId: 'a', load: 2 }, { doctorId: 'b', load: 0 }, { doctorId: 'c', load: 1 }]);
    expect(db.st.encounters.get('e1')).toMatchObject({ departmentId: DEPT_NEW, doctorId: 'b', status: 'waiting_for_doctor' });
    expect(db.st.appointments.get('ap-e1')).toMatchObject({ departmentId: DEPT_NEW, doctorId: 'b', slotId: 'slot-1' }); // slot giữ nguyên
    expect(r.queueEntry).toMatchObject({ doctorId: 'b', departmentId: DEPT_NEW, queueOrder: 5, priority: 'urgent', status: 'waiting', routedByUserId: 'u1' });
  });

  it('hoà tải -> dùng nguồn ngẫu nhiên; ép chỉ số để kiểm chứng đúng người được chọn', async () => {
    for (const [idx, expected] of [[0, 'a'], [1, 'b'], [2, 'c']] as const) {
      const db = makeDb();
      ['a', 'b', 'c'].forEach((d) => db.addDoctor(d, [DEPT_NEW]));
      db.addEncounter('e1');
      const s = svcOf(db); s.forced = [idx];
      const r = await s.changeDepartment('e1', { departmentId: DEPT_NEW }, 'u1');
      expect(r.current.doctor.doctorId).toBe(expected);
      expect(r.assignment.tiedCandidates).toBe(3);
    }
  });

  it('hoà tải thật: ngẫu nhiên nên qua nhiều lần đều có cả 3 bác sĩ được chọn', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const db = makeDb(); ['a', 'b', 'c'].forEach((d) => db.addDoctor(d, [DEPT_NEW])); db.addEncounter('e1');
      seen.add((await svcOf(db).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u')).current.doctor.doctorId);
    }
    expect(seen.size).toBe(3);
  });

  it('chỉ xét bác sĩ ĐANG TRONG CA; bác sĩ ca chiều/đã hết ca/isActive=false bị loại dù tải = 0', async () => {
    const db = makeDb();
    db.addDoctor('on', [DEPT_NEW], [7, 11.5]);
    db.addDoctor('later', [DEPT_NEW], [13, 17]);
    db.addDoctor('ended', [DEPT_NEW], [6, 9.5]);
    db.addDoctor('inactive', [DEPT_NEW], [7, 11.5], false);
    db.addDoctor('otherDept', [DEPT_OLD], [7, 11.5]);
    db.addEntry(entry({ encounterId: 'x', doctorId: 'on', queueOrder: 1 }));
    db.addEncounter('e1');
    const r = await svcOf(db).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u');
    expect(r.current.doctor.doctorId).toBe('on');
    expect(r.assignment.candidates).toEqual([{ doctorId: 'on', load: 1 }]);
  });

  it('chuyển lại (re-route) entry đang waiting: cập nhật đúng entry cũ, không tạo entry mới, không tính entry của chính mình vào tải', async () => {
    const db = makeDb();
    db.addDoctor('shared', [DEPT_OLD, DEPT_NEW]); db.addDoctor('other', [DEPT_NEW]);
    const old = db.addEntry({ encounterId: 'e1', doctorId: 'shared', departmentId: DEPT_OLD, doctorQueueDate: TODAY, queueOrder: 1, status: 'waiting' });
    db.addEntry(entry({ encounterId: 'x', doctorId: 'other', queueOrder: 1 }));
    db.addEncounter('e1', { status: 'waiting_for_doctor', doctorId: 'shared' });
    const r = await svcOf(db).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u');
    // 'shared' có 0 ca của người khác, 'other' có 1 -> chọn 'shared' (nếu tính nhầm entry cũ của e1 thì shared=1 hoà và có thể chọn 'other')
    expect(r.current.doctor.doctorId).toBe('shared');
    expect(r.assignment.candidates).toEqual([{ doctorId: 'other', load: 1 }, { doctorId: 'shared', load: 0 }]);
    expect(db.st.entries.filter((e) => e.encounterId === 'e1')).toHaveLength(1);
    expect(r.queueEntry.queueEntryId).toBe(old.queueEntryId);
    expect(r.queueEntry).toMatchObject({ departmentId: DEPT_NEW, queueOrder: 2, status: 'waiting' });
    expect(r.current.encounterStatus).toBe('waiting_for_doctor');
  });

  it('entry đã skipped thì cho phép xếp lại', async () => {
    const db = makeDb(); db.addDoctor('a', [DEPT_NEW]);
    db.addEntry({ encounterId: 'e1', doctorId: 'old-doc', departmentId: DEPT_OLD, doctorQueueDate: TODAY, queueOrder: 1, status: 'skipped' });
    db.addEncounter('e1', { status: 'waiting_for_doctor' });
    expect((await svcOf(db).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u')).queueEntry.status).toBe('waiting');
  });
});

describe('cân bằng tải', () => {
  it('tuần tự: 301 bệnh nhân vào 4 bác sĩ -> lệch tối đa 1 ở MỌI bước', async () => {
    const db = makeDb(); const docs = ['a', 'b', 'c', 'd']; docs.forEach((d) => db.addDoctor(d, [DEPT_NEW]));
    const s = svcOf(db);
    for (let i = 0; i < 301; i++) {
      db.addEncounter('e' + i);
      await s.changeDepartment('e' + i, { departmentId: DEPT_NEW }, 'u');
      const loads = docs.map((d) => loadOf(db, d));
      expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
    }
    expect(docs.map((d) => loadOf(db, d)).reduce((a, b) => a + b)).toBe(301);
    // queueOrder theo khoa liên tục 1..301, không trùng
    expect(db.st.entries.map((e) => e.queueOrder).sort((a, b) => a - b)).toEqual(Array.from({ length: 301 }, (_, i) => i + 1));
  });

  it('ĐỒNG THỜI: 90 request song song -> vẫn lệch tối đa 1, queueOrder không trùng (nhờ advisory lock)', async () => {
    const db = makeDb(); const docs = ['a', 'b', 'c']; docs.forEach((d) => db.addDoctor(d, [DEPT_NEW]));
    const s = svcOf(db);
    for (let i = 0; i < 90; i++) db.addEncounter('e' + i);
    await Promise.all(Array.from({ length: 90 }, (_, i) => s.changeDepartment('e' + i, { departmentId: DEPT_NEW }, 'u')));
    const loads = docs.map((d) => loadOf(db, d));
    expect(loads.reduce((a, b) => a + b)).toBe(90);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
    expect(new Set(db.st.entries.map((e) => e.queueOrder)).size).toBe(90);
  });

  it('(đối chứng) KHÔNG có lock thì cùng kịch bản đồng thời bị mất cân bằng/đụng unique -> chứng minh lock là cần thiết', async () => {
    const db = makeDb({ lock: false }); ['a', 'b', 'c'].forEach((d) => db.addDoctor(d, [DEPT_NEW]));
    const s = svcOf(db);
    for (let i = 0; i < 90; i++) db.addEncounter('e' + i);
    const results = await Promise.allSettled(Array.from({ length: 90 }, (_, i) => s.changeDepartment('e' + i, { departmentId: DEPT_NEW }, 'u')));
    const failed = results.filter((r) => r.status === 'rejected').length;
    const loads = ['a', 'b', 'c'].map((d) => loadOf(db, d));
    expect(failed > 0 || Math.max(...loads) - Math.min(...loads) > 1).toBe(true);
  });
});

describe('điều kiện từ chối (DB phải giữ nguyên)', () => {
  const unchanged = (db: ReturnType<typeof makeDb>) => {
    expect(db.st.encounters.get('e1')).toMatchObject({ departmentId: DEPT_OLD, doctorId: 'old-doc' });
    expect(db.st.entries.filter((e) => e.encounterId === 'e1')).toHaveLength(0);
  };
  it('không có bác sĩ nào đang trong ca -> 400, không đổi gì', async () => {
    const db = makeDb(); db.addDoctor('late', [DEPT_NEW], [13, 17]); db.addEncounter('e1');
    await expect(svcOf(db).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u')).rejects.toThrow(/không có bác sĩ nào đang trong ca/);
    unchanged(db);
  });
  it('chưa có phiên sinh hiệu -> 400', async () => {
    const db = makeDb(); db.addDoctor('a', [DEPT_NEW]); db.addEncounter('e1', { vitals: 0 });
    await expect(svcOf(db).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u')).rejects.toThrow(/sinh hiệu/);
    unchanged(db);
  });
  it.each(['arrived', 'in_progress', 'finished', 'cancelled'])('encounter %s -> 400', async (status) => {
    const db = makeDb(); db.addDoctor('a', [DEPT_NEW]); db.addEncounter('e1', { status });
    await expect(svcOf(db).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u')).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each(['called', 'in_progress', 'done'])('bác sĩ đã %s -> 400', async (status) => {
    const db = makeDb(); db.addDoctor('a', [DEPT_NEW]);
    db.addEntry({ encounterId: 'e1', doctorId: 'old-doc', departmentId: DEPT_OLD, doctorQueueDate: TODAY, queueOrder: 1, status });
    db.addEncounter('e1', { status: 'waiting_for_doctor' });
    await expect(svcOf(db).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u')).rejects.toThrow(/không thể đổi khoa/);
  });
  it('khoa trùng khoa hiện tại / khoa không tồn tại / khoa không hoạt động / encounter không tồn tại', async () => {
    const db = makeDb(); db.addDoctor('a', [DEPT_NEW]); db.addEncounter('e1');
    const s = svcOf(db);
    await expect(s.changeDepartment('e1', { departmentId: DEPT_OLD }, 'u')).rejects.toThrow(/trùng/);
    await expect(s.changeDepartment('e1', { departmentId: 'nope' }, 'u')).rejects.toBeInstanceOf(NotFoundException);
    db.st.departments.get(DEPT_NEW).isActive = false;
    await expect(s.changeDepartment('e1', { departmentId: DEPT_NEW }, 'u')).rejects.toThrow(/không hoạt động/);
    await expect(s.changeDepartment('missing', { departmentId: DEPT_NEW }, 'u')).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each(['DOCTOR', 'PATIENT', 'LAB_STAFF'])('actorRole %s bị chặn 403', async (role) => {
    const db = makeDb(); db.addDoctor('a', [DEPT_NEW]); db.addEncounter('e1');
    await expect(svcOf(db, role).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['NURSE', 'RECEPTIONIST', 'ADMIN'])('actorRole %s được phép', async (role) => {
    const db = makeDb(); db.addDoctor('a', [DEPT_NEW]); db.addEncounter('e1');
    await expect(svcOf(db, role).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u')).resolves.toBeTruthy();
  });
  it('P2002 (đụng unique) -> 409 thân thiện, không lộ lỗi Prisma thô', async () => {
    const db = makeDb(); db.addDoctor('a', [DEPT_NEW]); db.addEncounter('e1');
    const { Prisma } = await import('@prisma/client');
    const prisma: any = { $transaction: async () => { throw new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: '7' }); } };
    await expect(new TestService(prisma, actor() as any).changeDepartment('e1', { departmentId: DEPT_NEW }, 'u')).rejects.toThrow(/thử lại/);
  });
});
