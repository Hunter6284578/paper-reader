import type { VocabItem } from '../../types';

interface Props {
  item: VocabItem;
}

export default function WordDetail({ item }: Props) {
  return (
    <div className="space-y-4">
      {/* 单词标题 */}
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold text-gray-900">{item.word}</h2>
        {item.phonetic && <span className="text-gray-500">{item.phonetic}</span>}
        {item.partOfSpeech && (
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{item.partOfSpeech}</span>
        )}
      </div>

      {/* 释义 */}
      {item.definitionEn && (
        <div>
          <p className="text-xs font-medium text-gray-400 mb-1">英文释义</p>
          <p className="text-base text-gray-800">{item.definitionEn}</p>
        </div>
      )}
      {item.definitionCn && (
        <div>
          <p className="text-xs font-medium text-gray-400 mb-1">中文释义</p>
          <p className="text-base text-gray-700">{item.definitionCn}</p>
        </div>
      )}

      {/* 例句 */}
      {item.exampleSentence && (
        <div>
          <p className="text-xs font-medium text-gray-400 mb-1">例句</p>
          <p className="text-sm text-gray-600 italic border-l-2 border-gray-200 pl-3">{item.exampleSentence}</p>
        </div>
      )}

      {/* 词根词缀 */}
      {item.wordRoots && (
        <div className="bg-amber-50 rounded-lg p-3">
          <p className="text-xs font-medium text-amber-700 mb-1">词根词缀</p>
          <p className="text-sm text-amber-900">{item.wordRoots}</p>
        </div>
      )}

      {/* 助记 */}
      {item.mnemonic && (
        <div className="bg-blue-50 rounded-lg p-3">
          <p className="text-xs font-medium text-blue-700 mb-1">助记</p>
          <p className="text-sm text-blue-900">{item.mnemonic}</p>
        </div>
      )}

      {/* 语境 */}
      {item.contexts && item.contexts.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-400 mb-2">论文语境 ({item.contexts.length})</p>
          <div className="space-y-2">
            {item.contexts.map((ctx) => (
              <div key={ctx.id} className="text-sm border-l-2 border-primary-200 pl-3">
                <p className="text-gray-600 italic">{ctx.sentence}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {ctx.paperTitle && `${ctx.paperTitle}`}
                  {ctx.pageNumber ? ` - 第 ${ctx.pageNumber} 页` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 学习状态 */}
      <div className="flex items-center gap-4 text-xs text-gray-400 border-t border-gray-100 pt-3">
        <span>复习 {item.totalReviews} 次</span>
        <span>间隔 {Math.round(item.intervalDays)} 天</span>
        <span>下次: {new Date(item.dueDate).toLocaleDateString('zh-CN')}</span>
      </div>
    </div>
  );
}
