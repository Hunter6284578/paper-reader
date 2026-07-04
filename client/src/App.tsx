import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useBackButton } from './hooks/useBackButton';
import { useReaderStore } from './stores/readerStore';
import SetupPage from './pages/SetupPage';

const PaperList = lazy(() => import('./pages/PaperList'));
const PaperReader = lazy(() => import('./pages/PaperReader'));
const VocabBook = lazy(() => import('./pages/VocabBook'));
const ReviewSession = lazy(() => import('./pages/ReviewSession'));
const LearnSession = lazy(() => import('./pages/LearnSession'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function App() {
  useBackButton();
  const theme = useReaderStore((s) => s.settings.theme);
  const [paired, setPaired] = useState(() => Boolean(localStorage.getItem('token')));

  useEffect(() => {
    const expired = () => setPaired(false);
    window.addEventListener('paper-reader:auth-expired', expired);
    return () => window.removeEventListener('paper-reader:auth-expired', expired);
  }, []);

  if (!paired) return <SetupPage onPaired={() => setPaired(true)} />;

  return (
    <div className={theme === 'dark' ? 'dark min-h-screen bg-gray-900' : 'min-h-screen bg-white'}>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">加载中…</div>}>
        <Routes>
          <Route path="/" element={<PaperList />} />
          <Route path="/paper/:id" element={<PaperReader />} />
          <Route path="/vocab" element={<VocabBook />} />
          <Route path="/review" element={<ReviewSession />} />
          <Route path="/learn" element={<LearnSession />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export default App;
