export interface SM2Card {
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
}

export interface SM2Result {
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  dueDate: Date;
}

/**
 * SM-2 间隔重复算法
 * @param card 当前卡片状态
 * @param quality 回答质量 (0-5)
 *   0 - 完全不记得
 *   1 - 看到答案有模糊印象
 *   2 - 看到答案觉得容易想起
 *   3 - 有难度但回忆成功
 *   4 - 稍有犹豫后回忆成功
 *   5 - 瞬间回忆成功
 */
export function sm2Schedule(card: SM2Card, quality: number): SM2Result {
  let { repetitions, intervalDays, easeFactor } = card;

  if (quality < 3) {
    // 回答错误：重置
    repetitions = 0;
    intervalDays = 1;
  } else {
    // 回答正确
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    repetitions += 1;
  }

  // 更新难度因子
  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  // 计算下次复习日期
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + Math.ceil(intervalDays));

  return { repetitions, intervalDays, easeFactor, dueDate };
}

/**
 * 将用户界面按钮映射到 SM-2 quality 值
 */
export const REVIEW_QUALITY_MAP = {
  forgot: 0,    // 忘记
  hard: 3,      // 困难
  good: 4,      // 记得
  easy: 5,      // 简单
} as const;

export type ReviewGrade = keyof typeof REVIEW_QUALITY_MAP;
