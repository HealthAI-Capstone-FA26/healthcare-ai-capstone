import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  API_PREFIX,
  AUDITED_READ_RESOURCES,
  AUDIT_ACTION,
  AUDIT_OUTCOME,
  AuditActionCode,
  AuditOutcomeCode,
  SENSITIVE_FIELD_PATTERN,
  SKIP_READ_PATH_PREFIXES,
  SKIP_WRITE_PREFIXES,
} from './audit-log.constants';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_CACHE_TTL_MS = 5 * 60_000;

export interface AuditEntry {
  actorType?: 'user' | 'system' | 'ai_service';
  actorUserId?: string | null;
  actorRole?: string | null;
  action: AuditActionCode;
  resourceType: string;
  resourceId?: string | null;
  patientId?: string | null;
  encounterId?: string | null;
  outcome?: AuditOutcomeCode;
  changes?: Prisma.InputJsonValue;
  accessReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * SE07 — Audit Log append-only (bảng AuditLog): "ai đã xem / sửa dữ liệu bệnh nhân, lúc nào, từ đâu, kết quả ra sao".
 *
 * Hai đường ghi:
 *  1. record(entry): API tường minh cho code nghiệp vụ / AI service (actorType 'ai_service', before/after chi tiết...).
 *  2. recordHttp(req,res): AuditLogMiddleware gọi khi response kết thúc -> tự động ghi MỌI request ghi và các request
 *     đọc tới tài nguyên PHI, kể cả bị từ chối (401/403) và đăng nhập thất bại — không phải sửa từng controller.
 *
 * Ghi log KHÔNG BAO GIỜ làm hỏng request: mọi lỗi chỉ được log cảnh báo. Không lưu giá trị body — chỉ lưu TÊN field
 * thay đổi (tránh rò rỉ dữ liệu nhạy cảm vào log); muốn before/after hãy gọi record() với `changes` đã che dữ liệu.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);
  private readonly roleCache = new Map<string, { role: string | null; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) { }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorType: entry.actorType ?? (entry.actorUserId ? 'user' : 'system'),
          actorUserId: entry.actorUserId ?? null,
          actorRole: entry.actorRole ?? null,
          action: entry.action,
          resourceType: entry.resourceType.slice(0, 50),
          resourceId: entry.resourceId?.slice(0, 64) ?? null,
          patientId: entry.patientId ?? null,
          encounterId: entry.encounterId ?? null,
          outcome: entry.outcome ?? AUDIT_OUTCOME.SUCCESS,
          changes: entry.changes ?? Prisma.JsonNull,
          accessReason: entry.accessReason?.slice(0, 255) ?? null,
          ipAddress: entry.ipAddress?.slice(0, 45) ?? null,
          userAgent: entry.userAgent?.slice(0, 255) ?? null,
          requestId: entry.requestId?.slice(0, 64) ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Không ghi được audit log (${entry.action} ${entry.resourceType}): ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ HTTP auto-capture

  async recordHttp(req: Request, res: Response, requestId: string): Promise<void> {
    try {
      const entry = await this.buildHttpEntry(req, res, requestId);
      if (entry) await this.record(entry);
    } catch (err) {
      this.logger.warn(`Không dựng được audit log HTTP: ${(err as Error).message}`);
    }
  }

  private async buildHttpEntry(req: Request, res: Response, requestId: string): Promise<AuditEntry | null> {
    const method = req.method.toUpperCase();
    if (method === 'OPTIONS' || method === 'HEAD') return null;

    const rawPath = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (!rawPath.startsWith(API_PREFIX)) return null; // /api/docs, socket.io...
    const path = rawPath.slice(API_PREFIX.length) || '/';
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return null; // health check

    const resourceType = segments[0];
    const isRead = method === 'GET';
    if (isRead) {
      if (!AUDITED_READ_RESOURCES.has(resourceType)) return null;
      if (SKIP_READ_PATH_PREFIXES.some((p) => path.startsWith(p))) return null;
    } else if (SKIP_WRITE_PREFIXES.some((p) => path.startsWith(p))) {
      return null;
    }

    const user = (req as Request & { user?: { userId?: string } }).user;
    const status = res.statusCode;
    const outcome: AuditOutcomeCode =
      status === 401 || status === 403 ? AUDIT_OUTCOME.DENIED : status >= 400 ? AUDIT_OUTCOME.ERROR : AUDIT_OUTCOME.SUCCESS;

    // Id: lấy từ đường dẫn (không phụ thuộc req.params vì middleware chạy trước routing).
    const uuids = segments.filter((s) => UUID_RE.test(s));
    const idAfter = (name: string): string | undefined => {
      const i = segments.indexOf(name);
      return i >= 0 && UUID_RE.test(segments[i + 1] ?? '') ? segments[i + 1] : undefined;
    };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;
    const pick = (key: string): string | undefined => {
      const v = body[key] ?? query[key];
      return typeof v === 'string' && UUID_RE.test(v) ? v : undefined;
    };

    let patientId = idAfter('patients') ?? pick('patientId');
    const encounterId = idAfter('encounters') ?? pick('encounterId');
    if (!patientId && encounterId) {
      const enc = await this.prisma.encounter.findUnique({ where: { encounterId }, select: { patientId: true } });
      patientId = enc?.patientId;
    }

    const actorUserId = user?.userId ?? null;
    const isAuth = resourceType === 'auth';
    const fields = !isRead && !isAuth ? this.safeFieldNames(body) : undefined;

    return {
      actorType: actorUserId ? 'user' : 'system',
      actorUserId,
      actorRole: actorUserId ? await this.lookupRole(actorUserId) : 'anonymous',
      action: this.deriveAction(method, path, status),
      resourceType,
      resourceId: uuids.length ? uuids[uuids.length - 1] : null,
      patientId: patientId ?? null,
      encounterId: encounterId ?? null,
      outcome,
      changes: {
        method,
        route: '/' + segments.map((s) => (UUID_RE.test(s) ? ':id' : s)).join('/'),
        statusCode: status,
        ...(fields && fields.length ? { fields } : {}),
        ...(isRead ? { queryKeys: Object.keys(query).filter((k) => !SENSITIVE_FIELD_PATTERN.test(k)) } : {}),
      },
      accessReason: this.header(req, 'x-access-reason') ?? null, // break-glass: lý do truy cập ngoài phân quyền
      ipAddress: this.clientIp(req),
      userAgent: this.header(req, 'user-agent') ?? null,
      requestId,
    };
  }

  private deriveAction(method: string, path: string, status: number): AuditActionCode {
    if (method === 'POST' && /^\/auth\/login(\/|$)/.test(path)) {
      return status >= 400 ? AUDIT_ACTION.LOGIN_FAILED : AUDIT_ACTION.LOGIN;
    }
    if (/\/sign(\/|$)/.test(path)) return AUDIT_ACTION.SIGN;
    if (/\/(export|download|pdf)(\/|$)/.test(path)) return AUDIT_ACTION.EXPORT;
    if (/\/print(\/|$)/.test(path)) return AUDIT_ACTION.PRINT;
    switch (method) {
      case 'GET':
        return AUDIT_ACTION.READ;
      case 'POST':
        return AUDIT_ACTION.CREATE;
      case 'DELETE':
        return AUDIT_ACTION.DELETE;
      default:
        return AUDIT_ACTION.UPDATE; // PUT | PATCH
    }
  }

  private safeFieldNames(body: Record<string, unknown>): string[] {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
    return Object.keys(body)
      .filter((k) => !SENSITIVE_FIELD_PATTERN.test(k))
      .slice(0, 50);
  }

  private header(req: Request, name: string): string | undefined {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  }

  private clientIp(req: Request): string | null {
    const fwd = this.header(req, 'x-forwarded-for');
    return (fwd ? fwd.split(',')[0].trim() : req.ip) || null;
  }

  private async lookupRole(userId: string): Promise<string | null> {
    const cached = this.roleCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.role;
    const user = await this.prisma.user.findUnique({ where: { userId }, select: { role: { select: { roleCode: true } } } });
    const role = user?.role?.roleCode ?? null;
    this.roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
    if (this.roleCache.size > 5000) this.roleCache.clear(); // chặn phình bộ nhớ
    return role;
  }

  // ------------------------------------------------------------------ Query (ADMIN)

  async query(dto: QueryAuditLogsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const where = this.buildWhere(dto);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /** "Ai đã truy cập hồ sơ bệnh nhân này": gom theo người dùng + hành động, kèm lần truy cập gần nhất. */
  async patientAccessSummary(patientId: string, dto: QueryAuditLogsDto) {
    const where = this.buildWhere({ ...dto, patientId });
    const grouped = await this.prisma.auditLog.groupBy({
      by: ['actorUserId', 'actorRole', 'action', 'outcome'],
      where,
      _count: { _all: true },
      _max: { occurredAt: true },
      orderBy: { _max: { occurredAt: 'desc' } },
      take: 200,
    });
    return {
      patientId,
      actors: grouped.map((g) => ({
        actorUserId: g.actorUserId,
        actorRole: g.actorRole,
        action: g.action,
        outcome: g.outcome,
        count: g._count._all,
        lastAccessAt: g._max.occurredAt,
      })),
    };
  }

  private buildWhere(dto: QueryAuditLogsDto): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {
      actorUserId: dto.actorUserId,
      patientId: dto.patientId,
      encounterId: dto.encounterId,
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      action: dto.action,
      outcome: dto.outcome,
    };
    if (dto.from || dto.to) {
      where.occurredAt = {
        ...(dto.from ? { gte: new Date(dto.from) } : {}),
        ...(dto.to ? { lte: new Date(dto.to) } : {}),
      };
    }
    return where;
  }
}
