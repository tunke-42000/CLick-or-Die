import { useEffect, useMemo, useRef, useState } from "react";

const KEYS = ["A", "S", "D", "F", "J", "K", "L", "Q", "W", "E", "R", "U", "I", "O", "P"];
const GAME_TIME = 30;
const STARTING_LIVES = 3;
const BEST_SCORE_KEY = "click-or-die-best";

function pickRandomKey(previous = "") {
  const pool = KEYS.filter((key) => key !== previous);
  return pool[Math.floor(Math.random() * pool.length)];
}

function getRoundWindow(correctCount) {
  if (correctCount >= 30) return 1100;
  if (correctCount >= 20) return 1400;
  if (correctCount >= 10) return 1700;
  return 2000;
}

function getRank(score) {
  if (score >= 6500) return "S";
  if (score >= 4500) return "A";
  if (score >= 2500) return "B";
  return "C";
}

function StatCard({ label, value, danger = false }) {
  return (
    <div className={`stat ${danger ? "danger" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone({ frequency = 440, duration = 0.08, type = "sine", volume = 0.03, sweepTo = null }) {
  const ctx = getAudioContext();

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);

  if (sweepTo) {
    osc.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
  }

  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playSuccessSound() {
  playTone({ frequency: 880, sweepTo: 1320, duration: 0.07, type: "triangle", volume: 0.035 });
}

function playMissSound() {
  playTone({ frequency: 220, sweepTo: 140, duration: 0.12, type: "sawtooth", volume: 0.04 });
}

function playStartSound() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();

  playTone({ frequency: 440, duration: 0.05, type: "sine", volume: 0.025 });
  setTimeout(() => playTone({ frequency: 660, duration: 0.06, type: "sine", volume: 0.025 }), 90);
  setTimeout(() => playTone({ frequency: 880, duration: 0.08, type: "sine", volume: 0.03 }), 180);
}

function playGameOverSound() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();

  playTone({ frequency: 420, sweepTo: 260, duration: 0.14, type: "square", volume: 0.035 });
  setTimeout(() => playTone({ frequency: 260, sweepTo: 160, duration: 0.18, type: "square", volume: 0.03 }), 120);
}

export default function App() {
  const [screen, setScreen] = useState("title");
  const [countdown, setCountdown] = useState(3);

  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_TIME);
  const [lives, setLives] = useState(STARTING_LIVES);

  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  const [currentKey, setCurrentKey] = useState("");
  const [reactionStart, setReactionStart] = useState(0);
  const [totalReaction, setTotalReaction] = useState(0);
  const [successfulHits, setSuccessfulHits] = useState(0);

  const [message, setMessage] = useState("SYSTEM IDLE");
  const [flashType, setFlashType] = useState(null);

  const roundTimeoutRef = useRef(null);
  const globalTimerRef = useRef(null);

  const avgReaction = successfulHits > 0 ? Math.round(totalReaction / successfulHits) : 0;
  const roundWindow = useMemo(() => getRoundWindow(correctCount), [correctCount]);

  const clearAllTimers = () => {
    if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);
    if (globalTimerRef.current) clearInterval(globalTimerRef.current);
  };

  const spawnNextKey = (previous = "") => {
    const next = pickRandomKey(previous || currentKey);
    setCurrentKey(next);
    setReactionStart(Date.now());
  };

  const beginPlay = () => {
    setScore(0);
    setTimeLeft(GAME_TIME);
    setLives(STARTING_LIVES);
    setCombo(0);
    setMaxCombo(0);
    setCorrectCount(0);
    setTotalReaction(0);
    setSuccessfulHits(0);
    setMessage("PRESS THE KEY");
    setFlashType(null);

    const firstKey = pickRandomKey();
    setCurrentKey(firstKey);
    setReactionStart(Date.now());
    setScreen("playing");
  };

const startGame = () => {
  clearAllTimers();
  playStartSound();
  setCountdown(3);
  setCurrentKey("");
  setMessage("SYSTEM ARMED");
  setFlashType(null);
  setScreen("countdown");
};

const endGame = () => {
  clearAllTimers();
  playGameOverSound();
  setCurrentKey("");
  setMessage("SYSTEM FAILURE");
  setScreen("result");
};

const handleCorrect = () => {
  const reaction = Date.now() - reactionStart;
  const nextCombo = combo + 1;
  const speedBonus = Math.max(0, 50 - Math.floor(reaction / 20));
  const gained = 100 + nextCombo * 10 + speedBonus;

  setScore((prev) => prev + gained);
  setCombo(nextCombo);
  setMaxCombo((prev) => Math.max(prev, nextCombo));
  setCorrectCount((prev) => prev + 1);
  setTotalReaction((prev) => prev + reaction);
  setSuccessfulHits((prev) => prev + 1);

  playSuccessSound();
  setMessage(speedBonus >= 35 ? "PERFECT" : "GOOD");
  setFlashType("success");
  spawnNextKey(currentKey);
};

const handleWrong = () => {
  setScore((prev) => Math.max(0, prev - 50));
  setCombo(0);
  playMissSound();
  setMessage("MISS");
  setFlashType("miss");
  spawnNextKey(currentKey);
};

const handleTimeout = () => {
  setCombo(0);
  playMissSound();
  setMessage("TOO SLOW");
  setFlashType("miss");

  setLives((prev) => {
    const nextLives = prev - 1;
    if (nextLives <= 0) {
      setTimeout(() => endGame(), 0);
    } else {
      setTimeout(() => spawnNextKey(currentKey), 0);
    }
    return nextLives;
  });
};

  useEffect(() => {
    const stored = localStorage.getItem(BEST_SCORE_KEY);
    if (stored) setBestScore(Number(stored));
  }, []);

  useEffect(() => {
    if (screen === "result" && score > bestScore) {
      setBestScore(score);
      localStorage.setItem(BEST_SCORE_KEY, String(score));
    }
  }, [screen, score, bestScore]);

  useEffect(() => {
    if (screen !== "countdown") return;

    if (countdown === 0) {
      beginPlay();
      return;
    }

    const id = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 800);

    return () => clearTimeout(id);
  }, [screen, countdown]);

  useEffect(() => {
    if (screen !== "playing") return;

    globalTimerRef.current = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => {
      if (globalTimerRef.current) clearInterval(globalTimerRef.current);
    };
  }, [screen]);

  useEffect(() => {
    if (screen === "playing" && timeLeft <= 0) endGame();
  }, [screen, timeLeft]);

  useEffect(() => {
    if (screen !== "playing" || !currentKey) return;

    if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);

    roundTimeoutRef.current = setTimeout(() => {
      handleTimeout();
    }, roundWindow);

    return () => {
      if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);
    };
  }, [screen, currentKey, roundWindow]);

  useEffect(() => {
    if (!flashType) return;
    const id = setTimeout(() => setFlashType(null), 130);
    return () => clearTimeout(id);
  }, [flashType]);

  useEffect(() => {
    if (screen !== "playing") return;

    const onKeyDown = (e) => {
      if (e.repeat) return;
      const pressed = e.key.toUpperCase();

      if (pressed.length !== 1) return;
      if (!KEYS.includes(pressed)) return;

      if (pressed === currentKey) handleCorrect();
      else handleWrong();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen, currentKey, combo, reactionStart]);

  useEffect(() => {
    return () => clearAllTimers();
  }, []);

  const isDanger = timeLeft <= 10 || lives === 1;

  return (
    <div className="app">
      {flashType && <div className={`flash ${flashType}`} />}

      <div className="shell">
        <header className="header">
          <div>
            <div className="eyebrow">Emergency Input Protocol</div>
            <h1 className="title">CLICK OR DIE</h1>
          </div>
          <div className="badge">{screen === "playing" ? "Live" : "Standby"}</div>
        </header>

        <main className="main">
          {screen === "title" && (
            <div className="center-screen">
              <div className="panel">
                <div className="warning">Warning</div>
                <h2 className="hero1">CLICK</h2>
                <h2 className="hero2">OR DIE</h2>

                <p className="desc">
                  画面中央に表示されたキーを、制限時間内に素早く押し続けろ。
                  遅ければライフを失い、時間が尽きればシステムは崩壊する。
                </p>

                <div className="stats3">
                  <StatCard label="Game Time" value={`${GAME_TIME}s`} />
                  <StatCard label="Lives" value={STARTING_LIVES} />
                  <StatCard label="Best Score" value={bestScore} />
                </div>

                <button className="start-btn" onClick={startGame}>Start</button>
              </div>
            </div>
          )}

          {screen === "countdown" && (
            <div className="center-screen">
              <div className="countdown">{countdown}</div>
            </div>
          )}

          {(screen === "playing" || screen === "result") && (
            <>
              <section className="stats-top">
                <StatCard label="Score" value={score} />
                <StatCard label="Time" value={timeLeft} danger={timeLeft <= 10 && screen === "playing"} />
                <StatCard label="Lives" value={lives} danger={lives === 1 && screen === "playing"} />
              </section>

              <section className="game-grid">
                <div className="arena">
                  <div className={`arena-inner ${isDanger && screen === "playing" ? "danger" : ""}`} />

                  <div className="target-wrap">
                    <div className="target-label">Target Key</div>

                    {screen === "playing" ? (
                      <div className="key-box">{currentKey}</div>
                    ) : (
                      <div className="rank-box">{getRank(score)}</div>
                    )}

                    <div className="status-text">
                      {screen === "playing" ? message : "Final Rank"}
                    </div>

                    {screen === "playing" && (
                      <div className="window-wrap">
                        <div className="window-head">
                          <span>Reaction Window</span>
                          <span>{(roundWindow / 1000).toFixed(1)}s</span>
                        </div>
                        <div className="window-bar">
                          <div
                            className={`window-fill ${roundWindow <= 1400 ? "danger" : ""}`}
                            style={{ width: `${(roundWindow / 2000) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="side">
                  <div className="side-card">
                    <div className="side-title">Combat Feed</div>
                    <div className="feed-row"><span>Combo</span><span className="feed-strong feed-red">{combo}</span></div>
                    <div className="feed-row"><span>Max Combo</span><span className="feed-strong">{maxCombo}</span></div>
                    <div className="feed-row"><span>Avg Reaction</span><span className="feed-strong">{avgReaction ? `${avgReaction} ms` : "--"}</span></div>
                    <div className="feed-row"><span>Difficulty</span><span className="feed-strong">{correctCount}</span></div>
                  </div>

                  <div className="side-card">
                    <div className="side-title">How to Survive</div>
                    <ul className="help-list">
                      <li>中央のキーを押す</li>
                      <li>正解で加点、コンボ継続</li>
                      <li>間違えると減点</li>
                      <li>遅すぎるとライフ減少</li>
                      <li>後半ほど制限時間が短くなる</li>
                    </ul>
                  </div>

                  {screen === "result" && (
                    <div className="side-card">
                      <div className="side-title">System Report</div>
                      <div className="feed-row"><span>Final Score</span><span className="feed-strong">{score}</span></div>
                      <div className="feed-row"><span>Rank</span><span className="feed-strong feed-red">{getRank(score)}</span></div>
                      <div className="feed-row"><span>Best Score</span><span className="feed-strong">{bestScore}</span></div>
                      <button className="retry-btn" onClick={startGame}>Retry</button>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}