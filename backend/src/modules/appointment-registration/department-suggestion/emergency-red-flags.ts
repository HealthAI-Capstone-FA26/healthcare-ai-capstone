import { findPhrase, TokenizedText } from './keyword-matcher.util';

// LỚP AN TOÀN — cố ý nằm TRONG CODE (có version control + unit test), KHÔNG nằm trong DB/seed:
// admin sửa nhầm symptomKeywords của khoa Cấp cứu thì dấu hiệu nguy hiểm vẫn không bị bỏ sót.
//
// Nguyên tắc thiết kế:
//  - Ưu tiên độ nhạy (sensitivity) hơn độ đặc hiệu: báo dư 1 ca "nên đi cấp cứu" rẻ hơn nhiều so với
//    bỏ sót 1 ca đột quỵ/nhồi máu và xếp lịch khám thường vài ngày sau.
//  - Kết quả CHỈ là gợi ý điều hướng, không phải chẩn đoán. Danh sách này cần được bác sĩ cấp cứu của
//    bệnh viện rà soát/ký duyệt trước khi go-live (xem REVIEW.md).
//
// Mỗi rule: `anyOf` là danh sách các nhóm AND; chỉ cần 1 nhóm khớp đủ mọi cụm trong nhóm là kích hoạt.
// `unless`: nếu xuất hiện bất kỳ cụm nào ở đây thì bỏ qua rule (vd. "di chứng đột quỵ" là nhu cầu phục hồi
// chức năng, không phải ca đột quỵ đang diễn ra).
export interface EmergencyRule {
  id: string;
  reason: string;
  anyOf: string[][];
  unless?: string[];
  advice?: string;
}

export const EMERGENCY_ADVICE =
  'Đây có thể là dấu hiệu cần xử trí khẩn cấp. Vui lòng gọi 115 hoặc đến ngay Khoa Cấp cứu (mở cửa 24/7), không chờ đặt lịch khám thông thường.';

export const MENTAL_CRISIS_ADVICE =
  'Nếu bạn hoặc người thân đang có ý nghĩ tự làm hại bản thân, hãy gọi 115 hoặc đến ngay cơ sở cấp cứu gần nhất và không để người đó ở một mình.';

const HISTORICAL_OR_PREVENTIVE = ['di chứng', 'phục hồi', 'tầm soát', 'phòng ngừa', 'nguy cơ', 'tiền sử', 'từng bị', 'đã từng', 'tái khám', 'sau đột quỵ', 'sau tai biến'];

export const EMERGENCY_RULES: EmergencyRule[] = [
  {
    id: 'cardiac',
    reason: 'Đau ngực có dấu hiệu nguy hiểm (nghi hội chứng vành cấp)',
    anyOf: [
      ['đau ngực dữ dội'],
      ['đau ngực', 'khó thở'],
      ['đau ngực', 'vã mồ hôi'],
      ['đau ngực', 'mồ hôi lạnh'],
      ['đau ngực', 'lan ra tay'],
      ['đau ngực', 'lan ra cánh tay'],
      ['đau ngực', 'lan lên vai'],
      ['đau ngực', 'lan lên hàm'],
      ['đau ngực', 'ngất'],
      ['tức ngực', 'khó thở'],
      ['nặng ngực', 'khó thở'],
      ['nhồi máu cơ tim'],
    ],
    unless: ['tầm soát', 'phòng ngừa', 'tái khám'],
  },
  {
    id: 'stroke-signs',
    reason: 'Dấu hiệu nghi đột quỵ (yếu/liệt nửa người, méo miệng, nói khó...)',
    anyOf: [
      ['méo miệng'],
      ['liệt nửa người'],
      ['yếu nửa người'],
      ['tê nửa người'],
      ['liệt mặt', 'đột ngột'],
      ['nói khó', 'đột ngột'],
      ['nói ngọng', 'đột ngột'],
      ['nói khó', 'yếu tay'],
      ['mất thị lực đột ngột'],
      ['nhìn mờ đột ngột'],
      ['đau đầu dữ dội'],
      ['yếu liệt tay chân đột ngột'],
    ],
  },
  {
    id: 'stroke-term',
    reason: 'Nhắc đến đột quỵ / tai biến mạch máu não',
    anyOf: [['đột quỵ'], ['tai biến mạch máu não'], ['tai biến']],
    unless: HISTORICAL_OR_PREVENTIVE,
  },
  {
    id: 'breathing',
    reason: 'Khó thở nặng / suy hô hấp',
    anyOf: [
      ['khó thở nặng'], ['khó thở dữ dội'], ['khó thở đột ngột'], ['không thở được'], ['thở không nổi'],
      ['thở không ra hơi'], ['tím tái'], ['môi tím'], ['nghẹt thở'], ['thở rút lõm ngực'], ['ngưng thở'],
      ['ho ra máu'], ['hóc dị vật'],
    ],
    unless: ['khi ngủ', 'lúc ngủ', 'trong khi ngủ', 'khám ngưng thở'],
  },
  {
    id: 'bleeding',
    reason: 'Chảy máu nhiều / xuất huyết tiêu hoá',
    anyOf: [
      ['chảy máu nhiều'], ['mất máu nhiều'], ['máu chảy không cầm'], ['không cầm được máu'], ['chảy máu không cầm'],
      ['nôn ra máu'], ['ói ra máu'], ['nôn máu'], ['phân đen'], ['đi cầu ra máu nhiều'], ['đi ngoài ra máu nhiều'],
      ['chảy máu cam không cầm'], ['máu cam không cầm'], ['băng huyết'], ['ra máu âm đạo nhiều'],
    ],
  },
  {
    id: 'consciousness',
    reason: 'Rối loạn ý thức (bất tỉnh, hôn mê, co giật)',
    anyOf: [['bất tỉnh'], ['hôn mê'], ['mê man'], ['li bì'], ['không tỉnh'], ['lú lẫn đột ngột'], ['co giật']],
    unless: ['tiền sử co giật', 'tiền sử động kinh', 'tái khám', 'hay bị'],
  },
  {
    id: 'syncope',
    reason: 'Ngất / xỉu',
    anyOf: [['ngất'], ['ngất xỉu'], ['xỉu'], ['choáng ngất']],
    unless: ['thỉnh thoảng', 'thường xuyên', 'hay bị', 'đôi khi', 'tiền sử', 'từng bị', 'tháng trước', 'năm ngoái'],
  },
  {
    id: 'trauma',
    reason: 'Chấn thương nặng / tai nạn',
    anyOf: [
      ['tai nạn giao thông'], ['tai nạn lao động'], ['va chạm giao thông'], ['té xe'], ['ngã xe'],
      ['chấn thương sọ não'], ['chấn thương đầu'], ['chấn thương nặng'], ['ngã từ trên cao'], ['rơi từ trên cao'],
      ['gãy xương hở'], ['xương lòi ra'], ['vết thương sâu'], ['bị đâm'], ['bị chém'], ['bị bắn'],
      ['bỏng nặng'], ['bỏng độ 3'], ['điện giật'], ['đuối nước'], ['ngạt nước'],
    ],
    unless: ['tháng trước', 'năm ngoái', 'sau tai nạn', 'di chứng', 'đã từng', 'từng bị', 'tiền sử', 'hồi nhỏ', 'tái khám', 'phục hồi'],
  },
  {
    id: 'poisoning',
    reason: 'Ngộ độc / uống nhầm thuốc, hoá chất',
    anyOf: [
      ['ngộ độc thuốc'], ['ngộ độc hóa chất'], ['ngộ độc khí'], ['ngộ độc rượu'], ['ngộ độc nấm'], ['ngộ độc cấp'],
      ['uống nhầm thuốc'], ['uống nhầm hóa chất'], ['uống thuốc quá liều'], ['uống quá liều'], ['nuốt nhầm'],
      ['thuốc trừ sâu'], ['thuốc diệt cỏ'],
    ],
  },
  {
    id: 'anaphylaxis',
    reason: 'Nghi phản vệ',
    anyOf: [['sốc phản vệ'], ['phản vệ'], ['dị ứng', 'khó thở'], ['sưng môi', 'khó thở'], ['sưng lưỡi'], ['phù mặt', 'khó thở'], ['sưng mặt', 'khó thở'], ['nổi mề đay', 'khó thở']],
  },
  {
    id: 'obstetric',
    reason: 'Cấp cứu sản khoa',
    anyOf: [
      ['vỡ ối'], ['ra nước ối'], ['chuyển dạ'], ['đau đẻ'], ['băng huyết sau sinh'],
      ['ra máu', 'mang thai'], ['ra máu', 'có thai'], ['ra huyết', 'mang thai'], ['ra huyết', 'có thai'],
      ['đau bụng dữ dội', 'mang thai'], ['thai không máy'], ['thai ngừng máy'], ['giảm cử động thai'],
    ],
  },
  {
    id: 'pediatric-danger',
    reason: 'Dấu hiệu nguy hiểm ở trẻ em / sơ sinh',
    anyOf: [
      ['bé', 'bỏ bú'], ['trẻ', 'bỏ bú'], ['sơ sinh', 'bỏ bú'], ['sơ sinh', 'sốt'], ['sơ sinh', 'tím'],
      ['trẻ', 'khó thở'], ['bé', 'khó thở'], ['trẻ', 'thở rên'], ['sốt', 'cứng cổ'],
      ['sốt trên 40'], ['sốt 40 độ'], ['sốt cao', 'li bì'],
    ],
  },
  {
    id: 'acute-abdomen',
    reason: 'Đau bụng dữ dội / bụng cứng / đau tinh hoàn đột ngột',
    anyOf: [['đau bụng dữ dội'], ['bụng cứng'], ['đau tinh hoàn đột ngột']],
  },
  {
    id: 'eye-emergency',
    reason: 'Cấp cứu nhãn khoa',
    anyOf: [['hóa chất', 'vào mắt'], ['hóa chất', 'bắn vào mắt'], ['dị vật', 'đâm vào mắt']],
  },
  {
    id: 'venom',
    reason: 'Bị rắn cắn',
    anyOf: [['rắn cắn'], ['bị rắn cắn']],
  },
  {
    id: 'mental-crisis',
    reason: 'Có ý nghĩ tự làm hại bản thân',
    anyOf: [['tự tử'], ['tự sát'], ['muốn tự tử'], ['không muốn sống'], ['tự làm hại bản thân'], ['tự làm đau bản thân'], ['tự cắt tay']],
    advice: MENTAL_CRISIS_ADVICE,
  },
];

export interface EmergencyDetection {
  isEmergency: boolean;
  ruleIds: string[];
  reasons: string[];
  advice?: string;
}

const NO_EMERGENCY: EmergencyDetection = { isEmergency: false, ruleIds: [], reasons: [] };

export function detectEmergency(input: TokenizedText, rules: EmergencyRule[] = EMERGENCY_RULES): EmergencyDetection {
  if (input.exact.length === 0) return NO_EMERGENCY;

  const ruleIds: string[] = [];
  const reasons: string[] = [];
  let advice: string | undefined;
  let mentalCrisis = false;

  for (const rule of rules) {
    if (rule.unless?.some((ctx) => findPhrase(input, ctx, { ignoreNegation: true, allowPlainSingleSyllable: true }))) continue;

    const triggered = rule.anyOf.some((group) =>
      group.every((phrase) => findPhrase(input, phrase, { allowPlainSingleSyllable: true }) !== null),
    );
    if (!triggered) continue;

    ruleIds.push(rule.id);
    reasons.push(rule.reason);
    if (rule.id === 'mental-crisis') mentalCrisis = true;
  }

  if (ruleIds.length === 0) return NO_EMERGENCY;
  // Khủng hoảng tâm thần dùng thông điệp riêng nhưng vẫn kèm hướng dẫn cấp cứu chung.
  advice = mentalCrisis ? `${MENTAL_CRISIS_ADVICE} ${EMERGENCY_ADVICE}` : EMERGENCY_ADVICE;
  return { isEmergency: true, ruleIds, reasons, advice };
}
