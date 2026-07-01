import { Routes, Route } from 'react-router-dom';
import { useBackButton } from './hooks/useBackButton';
import PaperList from './pages/PaperList';
import PaperReader from './pages/PaperReader';
import VocabBook from './pages/VocabBook';
import ReviewSession from './pages/ReviewSession';
import LearnSession from './pages/LearnSession';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';
import { useState } from 'react';

function App() {
  useBackButton();
  const [paired, setPaired] = useState(() => Boolean(localStorage.getItem('token')));

  if (!paired) return <SetupPage onPaired={() => setPaired(true)} />;

  return (
    <Routes>
      <Route path="/" element={<PaperList />} />
      <Route path="/paper/:id" element={<PaperReader />} />
      <Route path="/vocab" element={<VocabBook />} />
      <Route path="/review" element={<ReviewSession />} />
      <Route path="/learn" element={<LearnSession />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}

export default App;
