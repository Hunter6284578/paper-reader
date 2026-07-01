/**
 * 公式检测服务 — 启发式检测文本中的数学公式并用 LaTeX 分隔符包裹
 * 保守策略：宁可漏检不误检
 */

/**
 * 检测文本中的数学公式并用 $...$ / $$...$$ 包裹
 */
export function detectFormulas(text: string): string {
  if (!text || text.length < 3) return text;

  // 已含 LaTeX 标记 → 不处理
  if (/\$\$[\s\S]+?\$\$|(?<!\$)\$(?!\$)[^$]+?\$(?!\$)|\\[\(\[]/.test(text)) {
    return text;
  }

  let result = text;

  // 1. 整行/整段是公式（block-level）
  if (isBlockFormula(result)) {
    return `$$${result.trim()}$$`;
  }

  // 2. 内联公式检测（按可靠性从高到低）
  result = wrapInlineFormulas(result);

  return result;
}

/**
 * 判断整段文本是否为一个独立的数学公式
 */
function isBlockFormula(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length > 300) return false;
  if (!hasBalancedDelimiters(trimmed)) return false;

  // 包含基本英文单词（非数学词汇）→ 不是公式
  const commonWords = /\b(the|a|an|is|are|was|were|this|that|these|those|we|our|it|its|for|from|with|can|will|should|would|could|may|might|has|have|had|been|being|which|who|what|where|when|how|not|but|and|or|if|then|than|into|by|on|at|to|of|in|as|using|based|shown|see|following|each|every|both|more|most|some|any|all|only|also|very|just|about|such|make|like|well|back|even|still|new|now|old|here|there|one|two|first|last|long|great|little|own|other|same|big|small|large|next|early|young|important|different|often|always|never|usually|sometimes|because|although|while|since|until|after|before|during|between|through|under|over|above|below|up|down|out|off|away|again|then|once)\b/i;
  if (commonWords.test(trimmed)) return false;

  // 包含句号、逗号（非小数点用法）→ 可能是自然语言
  if (/[;:!?]/.test(trimmed)) return false;

  // 以句末标点结束时优先视为正文，宁可只标记其中的内联公式。
  if (/[.!?;:]$/.test(trimmed)) return false;

  // 至少需要 2 个数学指标
  let mathSignals = 0;
  if (/[=<>≈≠≤≥]/.test(trimmed)) mathSignals++;
  if (/\^|_|\\/.test(trimmed)) mathSignals++;
  if (/\b(softmax|sigmoid|log|exp|sum|prod|Attention|MultiHead)\b/i.test(trimmed)) mathSignals++;
  if (/[α-ωΑ-Ω√∑∏∫∂∞∈∀∃⊂⊃⊆⊇∪∩]/.test(trimmed)) mathSignals++;
  if (/\([^)]*\)/.test(trimmed) && /[A-Z]/.test(trimmed)) mathSignals++; // 含大写字母的函数调用
  if (/\b[A-Z]\s*\(/.test(trimmed)) mathSignals++; // 如 Q(, K(, V(

  return mathSignals >= 2;
}

/**
 * 在文本中查找并包裹内联公式
 */
function wrapInlineFormulas(text: string): string {
  const matches: Array<{ start: number; end: number; text: string }> = [];

  const patterns: RegExp[] = [
    // Attention(Q,K,V) = softmax(...)V：按公式结构结束，避免吞掉后续正文。
    /\bAttention\s*\(\s*[A-Z]\s*(?:,\s*[A-Z]\s*)+\)\s*=\s*softmax\s*\((?:[^()]|\([^()]*\)){1,120}\)\s*[A-Za-z](?:\s*\(\d+\))?/g,

    // 数学函数 + 参数：softmax(...), log(...), exp(...), etc.
    /\b(?:softmax|sigmoid|tanh|ReLU|GELU|log|exp|ln|sqrt|sin|cos|argmax|argmin)\s*\((?:[^()]|\([^()]*\)){1,120}\)/g,

    // 希腊字母名（只匹配独立词，避免命中普通单词片段）
    /\b(?:alpha|beta|gamma|delta|epsilon|lambda|sigma|omega)\b/g,

    // 常见上标/下标：x^2、d_k、W^{(l)}、x_{i}
    /\b[A-Za-z][A-Za-z0-9]*\s*(?:\^\s*(?:\{[^{}]{1,20}\}|[A-Za-z0-9])|_\s*(?:\{[^{}]{1,20}\}|[A-Za-z0-9]))/g,

    // sum/prod 带上下标
    /\b(?:sum|prod|int)\s*[_^][^\s]{1,30}/g,

    // 等式链：X = ... = ...
    /\b[A-Za-z][A-Za-z0-9_^{}()]*\s*=\s*[^=\n.;]{1,50}\s*=\s*[^=\n.;]{1,50}/g,

    // 复杂度：O(n log n), O(n^2)
    /\bO\s*\(\s*n(?:\s+log\s+n|\s*\^\s*\d+|[\s*+n]*)\)/gi,

    // 概率/分布：P(x|y), P(x)
    /\bP\s*\(\s*[a-zA-Z]\s*(?:\|\s*[a-zA-Z]\s*)?\)/g,

    // 向量/矩阵转置：Q^T, W^T, x^T
    /\b[A-Z][a-zA-Z]*\s*\^\s*T\b/g,

    // 带下标的变量序列：x_1, x_2, ..., x_n
    /\b[a-zA-Z]_\{?1\}?\s*,\s*[a-zA-Z]_\{?2\}?\s*,\s*\.{3}\s*,\s*[a-zA-Z]_\{?[a-zA-Z]\}?\b/g,
  ];

  for (const pattern of patterns) {
    // Reset regex state for global patterns
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0].trim();
      if (matchedText.length < 3) continue;
      if (!hasBalancedDelimiters(matchedText)) continue;

      const leadingWhitespace = match[0].length - match[0].trimStart().length;
      const start = match.index + leadingWhitespace;
      const end = start + matchedText.length;

      // 检查是否已经被 $ 包裹
      const before = text[start - 1];
      if (before === '$') continue;

      matches.push({
        start,
        end,
        text: matchedText,
      });
    }
  }

  if (matches.length === 0) return text;

  // 按位置排序
  matches.sort((a, b) => a.start - b.start);

  // 去重（移除重叠的匹配，保留较长的）
  const filtered: typeof matches = [matches[0]];
  for (let i = 1; i < matches.length; i++) {
    const prev = filtered[filtered.length - 1];
    if (matches[i].start >= prev.end) {
      filtered.push(matches[i]);
    } else if (matches[i].text.length > prev.text.length) {
      filtered[filtered.length - 1] = matches[i];
    }
  }

  // 从后往前替换（避免偏移量变化）
  let result = text;
  for (let i = filtered.length - 1; i >= 0; i--) {
    const m = filtered[i];
    result = result.slice(0, m.start) + `$${m.text}$` + result.slice(m.end);
  }

  return result;
}

function hasBalancedDelimiters(text: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];

  for (const char of text) {
    if (char === '(' || char === '[' || char === '{') {
      stack.push(char);
    } else if (char in pairs) {
      if (stack.pop() !== pairs[char]) return false;
    }
  }

  return stack.length === 0;
}
