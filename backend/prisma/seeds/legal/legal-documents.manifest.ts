/**
 * Manifest văn bản pháp lý làm căn cứ cho các ConsentPolicy của phòng khám ngoại trú tim mạch.
 *
 * - `verified: true`  → URL PDF đã được mở và đối chiếu nội dung với nguồn chính thống (cổng Chính phủ).
 * - `verified: false` → mới xác định được văn bản/số hiệu/hiệu lực từ nguồn thứ cấp; cần người phụ trách
 *                       pháp lý tải bản gốc (có dấu đỏ/Công báo) và đặt vào `localFile` trước khi seed.
 *
 * File tải về đặt tại prisma/seeds/legal/files/ (xem scripts/fetch-legal-documents.ts).
 */
export interface LegalDocument {
    code: string;
    title: string;
    issuer: string;
    issuedOn: string; // ISO
    effectiveFrom: string; // ISO
    supersedes?: string;
    /** Tên file local trong prisma/seed/legal/files/ */
    localFile: string;
    /** URL PDF trực tiếp (nếu có) */
    sourceUrl: string | null;
    /** Trang tra cứu để tải thủ công khi chưa có URL PDF trực tiếp */
    pageUrl: string;
    sourceKind: 'official' | 'secondary';
    verified: boolean;
    notes?: string;
}

export const LEGAL_DOCUMENTS: LegalDocument[] = [
    {
        code: 'LAW-KCB-2023-CONSOLIDATED',
        title: 'Văn bản hợp nhất 26/VBHN-VPQH (2026) — Luật Khám bệnh, chữa bệnh 15/2023/QH15',
        issuer: 'Văn phòng Quốc hội',
        issuedOn: '2026-03-01', // năm/tháng theo đường dẫn datafiles.chinhphu.vn/.../2026/3/; cần đối chiếu ngày ký trên bản gốc
        effectiveFrom: '2024-01-01',
        localFile: 'vbhn-26-2026-luat-kham-benh-chua-benh.pdf',
        sourceUrl: 'https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/3/26-vbhn-vpqh.pdf',
        pageUrl: 'https://thuvienphapluat.vn/van-ban/The-thao-Y-te/Van-ban-hop-nhat-26-VBHN-VPQH-2026-Luat-Kham-benh-chua-benh-696163.aspx',
        sourceKind: 'official',
        verified: true,
        notes:
            'Bản hợp nhất đã gồm sửa đổi bởi Luật Quy hoạch 112/2025/QH15 (hiệu lực 01/03/2026) và Luật Dân số 113/2025/QH15 (hiệu lực 01/07/2026). Điều khoản dùng: 8, 9, 10, 11, 12, 13, 15, 18, 60, 65, 69, 77.',
    },
    {
        code: 'LAW-PDPL-91-2025',
        title: 'Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15',
        issuer: 'Quốc hội',
        issuedOn: '2025-06-26',
        effectiveFrom: '2026-01-01',
        localFile: 'luat-91-2025-qh15-bao-ve-du-lieu-ca-nhan.pdf',
        sourceUrl: 'https://static3.luatvietnam.vn/uploaded/others/2025/08/21/luat-91-2025-qh15_2108094941.pdf',
        pageUrl: 'https://thuvienphapluat.vn/van-ban/Bo-may-hanh-chinh/Luat-Bao-ve-du-lieu-ca-nhan-2025-so-91-2025-QH15-625628.aspx',
        sourceKind: 'secondary',
        verified: false,
        notes:
            'Số hiệu, ngày ban hành, hiệu lực đã đối chiếu qua nhiều nguồn. URL PDF là của LuatVietnam (thứ cấp, chưa mở được từ môi trường tra cứu) — nên thay bằng bản Công báo/quochoi.vn.',
    },
    {
        code: 'DECREE-356-2025',
        title: 'Nghị định 356/2025/NĐ-CP quy định chi tiết một số điều và biện pháp thi hành Luật Bảo vệ dữ liệu cá nhân',
        issuer: 'Chính phủ',
        issuedOn: '2025-12-31',
        effectiveFrom: '2026-01-01',
        supersedes: 'Nghị định 13/2023/NĐ-CP',
        localFile: 'nd-356-2025-nd-cp-huong-dan-luat-bvdlcn.pdf',
        sourceUrl: null,
        pageUrl: 'https://thuvienphapluat.vn/van-ban/Quyen-dan-su/Nghi-dinh-356-2025-ND-CP-huong-dan-Luat-Bao-ve-du-lieu-ca-nhan-687428.aspx',
        sourceKind: 'secondary',
        verified: false,
        notes:
            'Thay thế NĐ 13/2023/NĐ-CP. Có phụ lục 10 hồ sơ/biểu mẫu. Phân loại dữ liệu nhạy cảm (gồm tình trạng sức khỏe) ở Điều 4. Chưa tìm được PDF trực tiếp từ nguồn Chính phủ.',
    },
    {
        code: 'CIRCULAR-13-2025-BYT',
        title: 'Thông tư 13/2025/TT-BYT hướng dẫn triển khai hồ sơ bệnh án điện tử',
        issuer: 'Bộ Y tế',
        issuedOn: '2025-06-06',
        effectiveFrom: '2025-07-21',
        supersedes: 'Thông tư 46/2018/TT-BYT',
        localFile: 'tt-13-2025-tt-byt-ho-so-benh-an-dien-tu.pdf',
        sourceUrl: null,
        pageUrl: 'https://luatvietnam.vn/y-te/thong-tu-13-2025-tt-byt-huong-dan-trien-khai-ho-so-benh-an-dien-tu-tu-bo-y-te-402396-d1.html',
        sourceKind: 'secondary',
        verified: false,
        notes:
            'Bệnh viện phải triển khai EMR chậm nhất 30/09/2025; cơ sở khám chữa bệnh khác chậm nhất 31/12/2026 (theo tóm tắt thứ cấp — cần đối chiếu Điều 4 trên bản gốc).',
    },
];

export const LEGAL_DOCUMENT_BY_CODE = new Map(LEGAL_DOCUMENTS.map((d) => [d.code, d]));
