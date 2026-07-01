import { getDeepSeekConfig } from './modelSettings.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface StreamChunk {
  content: string;
  done: boolean;
}

/**
 * 调用 DeepSeek API 进行流式问答
 */
export async function streamChat(
  messages: ChatMessage[],
  onChunk: (chunk: StreamChunk) => void
): Promise<void> {
  const config = getDeepSeekConfig();
  if (!config.apiKey) throw new Error('请先在设置中配置 DeepSeek API Key');
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API 错误 (${response.status}): ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        onChunk({ content: '', done: true });
        return;
      }

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content || '';
        if (content) {
          onChunk({ content, done: false });
        }
      } catch {
        // 跳过解析失败的行
      }
    }
  }

  onChunk({ content: '', done: true });
}

/**
 * 构建 RAG 问答的 system prompt
 */
export function buildRAGSystemPrompt(
  contexts: Array<{
    content: string;
    sectionTitle: string | null;
    pageNumber: number | null;
    blockId: number | null;
    index: number;
  }>
): string {
  const contextText = contexts
    .map((c) => {
      const parts: string[] = [];
      parts.push(`Section: "${c.sectionTitle || '未分类'}"`);
      if (c.pageNumber) parts.push(`Page: ${c.pageNumber}`);
      if (c.blockId) parts.push(`Block: ${c.blockId}`);
      return `[${c.index + 1}] ${parts.join(' | ')}\n${c.content}`;
    })
    .join('\n\n---\n\n');

  return `你是一位严谨的学术论文解读助手。你的唯一信息来源是下方提供的论文片段。

## 强制规则

1. **仅基于提供的片段回答**。绝对禁止使用论文以外的知识，禁止推测、补充或编造论文中未提及的内容。
2. **如果片段中找不到答案**，必须回复："根据提供的论文内容，未找到相关依据。" 不要尝试用常识或外部知识作答。
3. **每个事实性陈述必须标注引用**，格式为 [n, p.X]，其中 n 是片段编号，X 是页码。
   - 正确：Transformer 使用多头自注意力机制 [1, p.5]，能够并行处理序列 [2, p.3]。
   - 错误：Transformer 使用多头自注意力机制。（缺少引用）
   - 错误：Transformer 使用多头自注意力机制 [1]。（缺少页码）
4. 引用多个来源时用逗号分隔：[1, p.5][2, p.3]。
5. 如果某段信息在提供的片段中无法确认，明确说明"提供的片段未涵盖此信息"。
6. 使用清晰、专业的语言，必要时可用中文解释英文术语。

## 论文片段

${contextText}`;
}

/**
 * 非流式调用（用于获取中文释义等简短回复）
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const config = getDeepSeekConfig();
  if (!config.apiKey) throw new Error('请先在设置中配置 DeepSeek API Key');
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 500,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API 错误 (${response.status}): ${error}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content || '';
}

/**
 * 生成词根词缀分析和助记方法
 */
export async function generateWordAnalysis(
  word: string,
  definition: string | null
): Promise<{ wordRoots: string | null; mnemonic: string | null }> {
  const config = getDeepSeekConfig();
  if (!config.apiKey) return { wordRoots: null, mnemonic: null };

  try {
    const result = await chatCompletion(
      [
        {
          role: 'system',
          content: '你是一位英语词源学专家。请分析单词的词根词缀，并提供一个简洁有效的助记方法。返回严格 JSON 格式，不要包含其他内容。',
        },
        {
          role: 'user',
          content: `分析单词 "${word}"${definition ? `（释义: ${definition}）` : ''}。
返回 JSON: { "roots": "词根词缀分析(简洁)", "mnemonic": "助记方法(一句话)" }
如果没有明显的词根词缀，roots 返回 null。`,
        },
      ],
      { maxTokens: 200, temperature: 0.5 }
    );

    // 尝试解析 JSON
    const cleaned = result.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned) as { roots?: string | null; mnemonic?: string | null };
    return {
      wordRoots: parsed.roots || null,
      mnemonic: parsed.mnemonic || null,
    };
  } catch (e) {
    console.warn('[词根] 分析失败:', word, e);
    return { wordRoots: null, mnemonic: null };
  }
}
