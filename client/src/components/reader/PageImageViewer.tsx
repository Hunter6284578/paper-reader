import { useState, useEffect } from 'react';
import type { PageImage } from '../../types';
import { fetchPageImages, resolveApiUrl } from '../../services/api';

interface PageImageViewerProps {
  paperId: string;
  target?: { pageNumber: number; bbox: number[] | null } | null;
}

export default function PageImageViewer({ paperId, target }: PageImageViewerProps) {
  const [images, setImages] = useState<PageImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchPageImages(paperId);
        if (!cancelled) {
          setImages(res.images);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || '加载页面图片失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [paperId]);

  useEffect(() => {
    if (target) setTimeout(() => document.querySelector(`[data-pdf-page="${target.pageNumber}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }, [target, images]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="text-center space-y-3">
          <div className="animate-spin text-3xl">⏳</div>
          <p className="text-gray-500 text-sm">加载页面图片中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="text-center space-y-2">
          <p className="text-gray-500">{error}</p>
          <p className="text-gray-400 text-sm">论文可能还在处理中，请稍后再试</p>
        </div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="text-center space-y-2">
          <p className="text-gray-500">暂无页面图片</p>
          <p className="text-gray-400 text-sm">论文页面图片正在生成中</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto scroll-container">
      <div className="sticky top-0 z-10 flex items-center justify-center gap-3 py-2 bg-white/90 backdrop-blur border-b border-gray-200">
        <button
          type="button"
          aria-label="缩小页面"
          onClick={() => setZoom((value) => Math.max(50, value - 10))}
          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200"
        >
          −
        </button>
        <input
          aria-label="页面缩放"
          type="range"
          min="50"
          max="200"
          step="10"
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="w-32"
        />
        <button
          type="button"
          aria-label="放大页面"
          onClick={() => setZoom((value) => Math.min(200, value + 10))}
          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200"
        >
          +
        </button>
        <span className="w-12 text-xs text-gray-500">{zoom}%</span>
      </div>
      <div className="px-4 py-6 space-y-6 min-w-min">
        {images.map((img) => (
          <div
            key={img.pageNumber}
            data-pdf-page={img.pageNumber}
            className="relative mx-auto transition-[width] duration-150"
            style={{ width: `${zoom}%`, maxWidth: 'none' }}
          >
            <div className="text-xs text-gray-400 mb-1 text-center">
              第 {img.pageNumber} 页
            </div>
            <img
              src={resolveApiUrl(`/images/${paperId}/${img.pageNumber}`)}
              alt={`Page ${img.pageNumber}`}
              className="w-full rounded-lg shadow-md"
              loading="lazy"
              decoding="async"
            />
            {target?.pageNumber === img.pageNumber && target.bbox && img.width && img.height && (
              <div className="absolute border-2 border-yellow-400 bg-yellow-300/20 pointer-events-none" style={{
                left: `${target.bbox[0] / (img.width / 2) * 100}%`,
                top: `${target.bbox[1] / (img.height / 2) * 100}%`,
                width: `${(target.bbox[2] - target.bbox[0]) / (img.width / 2) * 100}%`,
                height: `${(target.bbox[3] - target.bbox[1]) / (img.height / 2) * 100}%`,
                marginTop: '1.25rem',
              }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
