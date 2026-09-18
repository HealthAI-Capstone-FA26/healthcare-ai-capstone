// Cosine similarity giữa 2 embedding vector, trả về giá trị trong [-1, 1] (thường trong [0, 1]
// với embedding text vì hầu hết model xuất vector không âm theo hướng). Trả về 0 nếu vector
// rỗng/lệch chiều thay vì throw — semantic score là tín hiệu BỔ SUNG, không nên làm sập cả API
// gợi ý khoa chỉ vì 1 vector bất thường.
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
