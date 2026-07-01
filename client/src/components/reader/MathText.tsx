import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  text: string;
}

/**
 * 渲染包含数学公式的文本
 * 解析 $...$ 和 $$...$$ 标记，用 KaTeX 渲染公式
 * 渲染失败时降级显示原始文本
 */
export default function MathText({ text }: MathTextProps) {
  const parts = useMemo(() => parseMathText(text), [text]);

  return (
    <>
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.content}</span>
        ) : part.type === 'inline-math' ? (
          <span
            key={i}
            className="inline-math"
            dangerouslySetInnerHTML={{
              __html: renderLatex(part.content, false),
            }}
          />
        ) : (
          <div
            key={i}
            className="block-math my-3 text-center"
            dangerouslySetInnerHTML={{
              __html: renderLatex(part.content, true),
            }}
          />
        )
      )}
    </>
  );
}

type Part =
  | { type: 'text'; content: string }
  | { type: 'inline-math'; content: string }
  | { type: 'block-math'; content: string };

function parseMathText(text: string): Part[] {
  if (!text) return [];

  const parts: Part[] = [];
  // 匹配 $$...$$ (block) 或 $...$ (inline)
  const regex = /(\$\$[\s\S]+?\$\$|\$(?!\$)([^$\n]+?)\$(?!\$))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // 添加公式前的普通文本
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    const fullMatch = match[0];
    if (fullMatch.startsWith('$$')) {
      // Block math: $$...$$
      parts.push({
        type: 'block-math',
        content: fullMatch.slice(2, -2).trim(),
      });
    } else {
      // Inline math: $...$
      parts.push({
        type: 'inline-math',
        content: fullMatch.slice(1, -1).trim(),
      });
    }

    lastIndex = match.index + fullMatch.length;
  }

  // 添加剩余的普通文本
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text }];
}

function renderLatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      errorColor: '#cc0000',
      trust: true,
      strict: false,
    });
  } catch {
    // 渲染失败，降级显示原始文本
    return displayMode
      ? `<code class="math-fallback">${escapeHtml(latex)}</code>`
      : `<code class="math-fallback text-sm">${escapeHtml(latex)}</code>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
