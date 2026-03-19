import { useState, useRef } from 'react';

export default function FlickPad({ onInput }) {
  const [touchStartPos, setTouchStartPos] = useState(null);
  const [activeDirection, setActiveDirection] = useState(null);
  const padRef = useRef(null);

  const SWIPE_THRESHOLD = 30; // 30px for flick

  const handleTouchStart = (e) => {
    e.preventDefault(); // Prevent scrolling
    const touch = e.touches[0];
    setTouchStartPos({ x: touch.clientX, y: touch.clientY });
    setActiveDirection('tap'); // Default to tap
  };

  const handleTouchMove = (e) => {
    if (!touchStartPos) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartPos.x;
    const dy = touch.clientY - touchStartPos.y;

    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
      setActiveDirection('tap');
      return;
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      setActiveDirection(dx > 0 ? 'right' : 'left');
    } else {
      setActiveDirection(dy > 0 ? 'down' : 'up');
    }
  };

  const handleTouchEnd = (e) => {
    if (!touchStartPos || !activeDirection) {
      setTouchStartPos(null);
      setActiveDirection(null);
      return;
    }

    let inputChar = '';
    switch (activeDirection) {
      case 'tap': inputChar = 'あ'; break;
      case 'up': inputChar = 'い'; break;
      case 'right': inputChar = 'う'; break;
      case 'down': inputChar = 'え'; break;
      case 'left': inputChar = 'お'; break;
    }

    if (inputChar && onInput) {
      onInput(inputChar);
    }

    setTouchStartPos(null);
    setActiveDirection(null);
  };

  return (
    <div className="flick-pad-container">
      <div 
        ref={padRef}
        className={`flick-pad ${activeDirection ? 'active' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="flick-center">あ</div>
        <div className={`flick-dir top ${activeDirection === 'up' ? 'highlight' : ''}`}>い</div>
        <div className={`flick-dir right ${activeDirection === 'right' ? 'highlight' : ''}`}>う</div>
        <div className={`flick-dir bottom ${activeDirection === 'down' ? 'highlight' : ''}`}>え</div>
        <div className={`flick-dir left ${activeDirection === 'left' ? 'highlight' : ''}`}>お</div>
      </div>
    </div>
  );
}
