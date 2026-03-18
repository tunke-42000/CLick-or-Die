import { useEffect, useMemo, useRef, useState } from "react";
import clockTick from "./clock-tick.mp3";

const KEYS = ["A", "S", "D", "F", "J", "K", "L", "Q", "W", "E", "R", "U", "I", "O", "P"];
const GAME_TIME = 40;
const STARTING_LIVES = 5;
const TOP_SCORES_KEY = "click-or-die-top3";
const FAKE_KEY_CHANCE = 0.08;
const FAKE_PENALTY = 10;

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

function formatDateTime(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRank(index) {
  if (index === 0) return "1st";
  if (index === 1) return "2nd";
  if (index === 2) return "3rd";
  return `${index + 1}th`;
}

function updateTopScores(previousScores, newScore) {
  const nextScores = [
    ...previousScores,
    {
      score: newScore,
      playedAt: new Date().toISOString(),
    },
  ]
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime()
    )
    .slice(0, 3);

  try {
    localStorage.setItem(TOP_SCORES_KEY, JSON.stringify(nextScores));
  } catch (error) {
    console.error("Failed to save top scores:", error);
  }

  return nextScores;
}

function getRank(score) {
  if (score >= 800) return "Ω";
  if (score >= 760) return "Z";
  if (score >= 720) return "X";
  if (score >= 680) return "SSS";
  if (score >= 640) return "SS";
  if (score >= 600) return "S";
  if (score >= 560) return "A+";
  if (score >= 520) return "A";
  if (score >= 480) return "A-";
  if (score >= 465) return "B+";
  if (score >= 450) return "B";
  if (score >= 420) return "B-";
  if (score >= 390) return "C+";
  if (score >= 360) return "C";
  if (score >= 330) return "C-";
  if (score >= 290) return "D+";
  if (score >= 250) return "D";
  if (score >= 220) return "D-";
  if (score >= 180) return "E+";
  if (score >= 130) return "E";
  return "E-";
}

function getNextRankInfo(score) {
  const rankTable = [
    { min: 800, rank: "Ω" },
    { min: 760, rank: "Z" },
    { min: 720, rank: "X" },
    { min: 680, rank: "SSS" },
    { min: 640, rank: "SS" },
    { min: 600, rank: "S" },
    { min: 560, rank: "A+" },
    { min: 520, rank: "A" },
    { min: 480, rank: "A-" },
    { min: 465, rank: "B+" },
    { min: 450, rank: "B" },
    { min: 420, rank: "B-" },
    { min: 390, rank: "C+" },
    { min: 360, rank: "C" },
    { min: 330, rank: "C-" },
    { min: 290, rank: "D+" },
    { min: 250, rank: "D" },
    { min: 220, rank: "D-" },
    { min: 180, rank: "E+" },
    { min: 130, rank: "E" },
    { min: 0, rank: "E-" },
  ];

  const currentIndex = rankTable.findIndex((item) => score >= item.min);
  const current = rankTable[currentIndex];

  if (currentIndex <= 0) {
    return {
      currentRank: current.rank,
      nextRank: "MAX",
      need: 0,
    };
  }

  const next = rankTable[currentIndex - 1];

  return {
    currentRank: current.rank,
    nextRank: next.rank,
    need: next.min - score,
  };
}

function getJudgement(reaction) {
  if (reaction <= 400) return { label: "PERFECT", bonus: 4 };
  if (reaction <= 550) return { label: "GREAT", bonus: 3 };
  if (reaction <= 700) return { label: "GOOD", bonus: 2 };
  return { label: "SLOW", bonus: 0 };
}

function StatCard({ label, value, danger = false, hearts = false }) {
  return (
    <div className={`stat ${danger ? "danger" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${hearts ? "hearts" : ""}`}>{value}</div>
    </div>
  );
}

let audioCtx = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }

  return audioCtx;
}

function playTone({
  frequency = 440,
  duration = 0.08,
  type = "sine",
  volume = 0.03,
  sweepTo = null,
}) {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
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
  playTone({
    frequency: 880,
    sweepTo: 1320,
    duration: 0.07,
    type: "triangle",
    volume: 0.035,
  });
}

function playMissSound() {
  playTone({
    frequency: 220,
    sweepTo: 140,
    duration: 0.12,
    type: "sawtooth",
    volume: 0.04,
  });
}

function playStartSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  playTone({ frequency: 440, duration: 0.05, type: "sine", volume: 0.025 });
  setTimeout(() => playTone({ frequency: 660, duration: 0.06, type: "sine", volume: 0.025 }), 90);
  setTimeout(() => playTone({ frequency: 880, duration: 0.08, type: "sine", volume: 0.03 }), 180);
}

function playGameOverSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  playTone({
    frequency: 420,
    sweepTo: 260,
    duration: 0.14,
    type: "square",
    volume: 0.035,
  });

  setTimeout(
    () =>
      playTone({
        frequency: 260,
        sweepTo: 160,
        duration: 0.18,
        type: "square",
        volume: 0.03,
      }),
    120
  );
}

export default function App() {
  const [screen, setScreen] = useState("title");
  const [countdown, setCountdown] = useState(3);

  const [score, setScore] = useState(0);
  const [topScores, setTopScores] = useState([]);
  const [resultSaved, setResultSaved] = useState(false);
  const [timeLeft, setTimeLeft] = useState(GAME_TIME);
  const [lives, setLives] = useState(STARTING_LIVES);

  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  const [currentKey, setCurrentKey] = useState("");
  const [reactionStart, setReactionStart] = useState(0);
  const [totalReaction, setTotalReaction] = useState(0);
  const [successfulHits, setSuccessfulHits] = useState(0);
  const [isFake, setIsFake] = useState(false);

  const [message, setMessage] = useState("SYSTEM IDLE");
  const [flashType, setFlashType] = useState(null);
  const [comboMsg, setComboMsg] = useState(null);

  const roundTimeoutRef = useRef(null);
  const globalTimerRef = useRef(null);
  const tickAudioRef = useRef(null);

  const avgReaction = successfulHits > 0 ? Math.round(totalReaction / successfulHits) : 0;
  const roundWindow = useMemo(() => getRoundWindow(correctCount), [correctCount]);

  const actualRoundWindow = useMemo(() => {
    return isFake ? Math.max(450, roundWindow - 250) : roundWindow;
  }, [isFake, roundWindow]);

  const nextRankInfo = getNextRankInfo(score);

  const clearAllTimers = () => {
    if (roundTimeoutRef.current) {
      clearTimeout(roundTimeoutRef.current);
      roundTimeoutRef.current = null;
    }
    if (globalTimerRef.current) {
      clearInterval(globalTimerRef.current);
      globalTimerRef.current = null;
    }
  };

  const stopTickSound = () => {
    if (tickAudioRef.current) {
      tickAudioRef.current.pause();
      tickAudioRef.current.currentTime = 0;
    }
  };

  const spawnNextKey = (previous = "") => {
    const next = pickRandomKey(previous || currentKey);
    const fake = Math.random() < FAKE_KEY_CHANCE;

    setCurrentKey(next);
    setIsFake(fake);
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
    setComboMsg(null);
    setResultSaved(false);

    const firstKey = pickRandomKey();
    const firstFake = Math.random() < FAKE_KEY_CHANCE;

    setCurrentKey(firstKey);
    setIsFake(firstFake);
    setReactionStart(Date.now());
    setScreen("playing");
  };

  const startGame = () => {
    clearAllTimers();
    stopTickSound();
    playStartSound();
    setCountdown(3);
    setCurrentKey("");
    setIsFake(false);
    setMessage("SYSTEM ARMED");
    setFlashType(null);
    setScreen("countdown");
  };

  const endGame = () => {
    clearAllTimers();
    stopTickSound();
    playGameOverSound();
    setCurrentKey("");
    setIsFake(false);
    setMessage("SYSTEM FAILURE");
    setScreen("result");
  };

  const goToTitle = () => {
    clearAllTimers();
    stopTickSound();
    setCurrentKey("");
    setIsFake(false);
    setMessage("SYSTEM IDLE");
    setFlashType(null);
    setScreen("title");
  };

  const handleCorrect = () => {
    const reaction = Date.now() - reactionStart;
    const nextCombo = combo + 1;
    const judgement = getJudgement(reaction);
    const gained = 6 + Math.min(6, Math.floor(nextCombo / 2)) + judgement.bonus;

    setScore((prev) => prev + gained);
    setCombo(nextCombo);
    setMaxCombo((prev) => Math.max(prev, nextCombo));
    setCorrectCount((prev) => prev + 1);
    setTotalReaction((prev) => prev + reaction);
    setSuccessfulHits((prev) => prev + 1);

    if (nextCombo > 0) {
      if (nextCombo % 10 === 0) {
        setComboMsg({ text: `${nextCombo} COMBO!`, type: "milestone", id: Date.now() });
      } else if (nextCombo >= 2) {
        setComboMsg({ text: `${nextCombo} COMBO`, type: "normal", id: Date.now() });
      }
    }

    playSuccessSound();
    setMessage(judgement.label);
    setFlashType("success");
    spawnNextKey(currentKey);
  };

  const handleWrong = () => {
    setScore((prev) => Math.max(0, prev - 6));
    if (combo >= 5) setComboMsg({ text: "COMBO BREAK", type: "break", id: Date.now() });
    setCombo(0);
    playMissSound();
    setMessage("MISS");
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

  const handleFakeHit = () => {
    setScore((prev) => Math.max(0, prev - FAKE_PENALTY));
    if (combo >= 5) setComboMsg({ text: "COMBO BREAK", type: "break", id: Date.now() });
    setCombo(0);
    playMissSound();
    setMessage("TRAP");
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

  const handleTimeout = () => {
    if (isFake) {
      const nextCombo = combo + 1;
      setScore((prev) => prev + 6);
      setCombo(nextCombo);
      setMaxCombo((prev) => Math.max(prev, nextCombo));
      setCorrectCount((prev) => prev + 1);
      
      if (nextCombo > 0) {
        if (nextCombo % 10 === 0) {
          setComboMsg({ text: `${nextCombo} COMBO!`, type: "milestone", id: Date.now() });
        } else if (nextCombo >= 2) {
          setComboMsg({ text: `${nextCombo} COMBO`, type: "normal", id: Date.now() });
        }
      }

      setMessage("GOOD IGNORE");
      setFlashType("success");
      spawnNextKey(currentKey);
      return;
    }

    if (combo >= 5) setComboMsg({ text: "COMBO BREAK", type: "break", id: Date.now() });
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
    const audio = new Audio(clockTick);
    audio.loop = true;
    audio.volume = 0.35;
    tickAudioRef.current = audio;

    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);

  useEffect(() => {
    try {
      const storedScores = localStorage.getItem(TOP_SCORES_KEY);
      if (!storedScores) return;

      const parsedScores = JSON.parse(storedScores);
      if (Array.isArray(parsedScores)) {
        setTopScores(parsedScores);
      }
    } catch (error) {
      console.error("Failed to load top scores:", error);
    }
  }, []);

  useEffect(() => {
    if (screen !== "result" || resultSaved) return;
    setTopScores((prev) => updateTopScores(prev, score));
    setResultSaved(true);
  }, [screen, score, resultSaved]);

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
      if (globalTimerRef.current) {
        clearInterval(globalTimerRef.current);
        globalTimerRef.current = null;
      }
    };
  }, [screen]);

  useEffect(() => {
    if (screen === "playing" && timeLeft <= 0) {
      endGame();
    }
  }, [screen, timeLeft]);

  useEffect(() => {
    const audio = tickAudioRef.current;
    if (!audio) return;

    if (screen === "playing" && timeLeft <= 10 && timeLeft > 0) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [screen, timeLeft]);

  useEffect(() => {
    if (screen !== "playing" || !currentKey) return;

    if (roundTimeoutRef.current) {
      clearTimeout(roundTimeoutRef.current);
    }

    roundTimeoutRef.current = setTimeout(() => {
      handleTimeout();
    }, actualRoundWindow);

    return () => {
      if (roundTimeoutRef.current) {
        clearTimeout(roundTimeoutRef.current);
        roundTimeoutRef.current = null;
      }
    };
  }, [screen, currentKey, actualRoundWindow, isFake]);

  useEffect(() => {
    if (!flashType) return;
    const id = setTimeout(() => setFlashType(null), 130);
    return () => clearTimeout(id);
  }, [flashType]);

  useEffect(() => {
    if (!comboMsg) return;
    const id = setTimeout(() => setComboMsg(null), 600);
    return () => clearTimeout(id);
  }, [comboMsg]);

  useEffect(() => {
    if (screen !== "playing") return;

    const onKeyDown = (e) => {
      if (e.repeat) return;

      const pressed = e.key.toUpperCase();
      if (pressed.length !== 1) return;
      if (!KEYS.includes(pressed)) return;

      if (pressed === currentKey) {
        if (isFake) {
          handleFakeHit();
        } else {
          handleCorrect();
        }
      } else {
        handleWrong();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen, currentKey, isFake, combo, reactionStart]);

  useEffect(() => {
    return () => {
      clearAllTimers();
      stopTickSound();
    };
  }, []);

  const hpDisplay = "💛".repeat(lives) + "🖤".repeat(STARTING_LIVES - lives);
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
                  表示されたキーをすばやく押し続けろ。
                  たまに出現するフェイクキーは押してはいけない
                </p>

                <div className="stats3">
                  <StatCard label="Game Time" value={`${GAME_TIME}s`} />
                  <StatCard label="HP" value={"💛💛💛💛💛"} hearts />

                  <div className="stat stat-topscore">
                    <div className="stat-label">Top Score</div>

                    {topScores.length > 0 ? (
                      <div className="topscore-inner">
                        <div className="topscore-best">
                          <span className="topscore-best-score">{topScores[0].score}</span>
                          <span className="topscore-best-rank">{getRank(topScores[0].score)}</span>
                        </div>

                        <div className="topscore-list">
                          {topScores.map((item, index) => (
                            <div
                              className="topscore-line"
                              key={`${item.playedAt}-${item.score}-${index}`}
                            >
                              <span className="topscore-rank">{formatRank(index)}</span>
                              <span className="topscore-text">
                                {formatDateTime(item.playedAt)} : {item.score}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="topscore-empty">No records yet</div>
                    )}
                  </div>
                </div>

                <button className="start-btn" onClick={startGame}>
                  Start
                </button>
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
                <StatCard
                  label="Time"
                  value={timeLeft}
                  danger={timeLeft <= 10 && screen === "playing"}
                />
                <StatCard
                  label="HP"
                  value={hpDisplay}
                  hearts
                  danger={lives === 1 && screen === "playing"}
                />
              </section>

              <section className="game-grid">
                <div className="arena">
                  <div
                    className={`arena-inner ${
                      isDanger && screen === "playing" ? "danger" : ""
                    }`}
                  />

                  <div className="target-wrap">
                    <div className="target-label">Target Key</div>

                    {comboMsg && screen === "playing" && (
                      <div className="combo-msg-wrap">
                        <div key={comboMsg.id} className={`combo-text ${comboMsg.type}`}>
                          {comboMsg.text}
                        </div>
                      </div>
                    )}

                    {screen === "playing" ? (
                      <div
                        className={`key-box ${isFake ? "fake" : ""}`}
                        data-text={currentKey}
                      >
                        {currentKey}
                      </div>
                    ) : (
                      <div className="rank-box">{getRank(score)}</div>
                    )}

                    <div className="status-text">
                      {screen === "playing" ? message : "Final Rank"}
                    </div>

                    {screen === "playing" && (
                      <div className="window-wrap">
                        <div className="window-head">
                          <span>入力制限時間</span>
                          <span>{(actualRoundWindow / 1000).toFixed(1)}s</span>
                        </div>
                        <div className="window-bar">
                          <div
                            className={`window-fill ${
                              actualRoundWindow <= 1400 ? "danger" : ""
                            }`}
                            style={{ width: `${(actualRoundWindow / 2000) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="side">
                  <div className="side-card">
                    <div className="side-title">Combat Feed</div>
                    <div className="feed-row">
                      <span>Combo</span>
                      <span key={`side-${combo}`} className="feed-strong feed-red combo-side-anim">{combo}</span>
                    </div>
                    <div className="feed-row">
                      <span>Max Combo</span>
                      <span className="feed-strong">{maxCombo}</span>
                    </div>
                    <div className="feed-row">
                      <span>Avg Reaction</span>
                      <span className="feed-strong">
                        {avgReaction ? `${avgReaction} ms` : "--"}
                      </span>
                    </div>
                    <div className="feed-row">
                      <span>Hit</span>
                      <span className="feed-strong">{correctCount}</span>
                    </div>
                  </div>

                  {screen === "playing" && (
                    <div className="side-card">
                      <div className="side-title">Next Rank</div>
                      <div className="feed-row">
                        <span>Current</span>
                        <span className="feed-strong">{nextRankInfo.currentRank}</span>
                      </div>
                      <div className="feed-row">
                        <span>Next</span>
                        <span className="feed-strong feed-red">{nextRankInfo.nextRank}</span>
                      </div>
                      <div className="feed-row">
                        <span>Need</span>
                        <span className="feed-strong">
                          {nextRankInfo.need === 0 ? "CLEAR" : `${nextRankInfo.need} pts`}
                        </span>
                      </div>
                    </div>
                  )}

                  {screen === "result" && (
                    <div className="side-card">
                      <div className="side-title">System Report</div>
                      <div className="feed-row">
                        <span>Final Score</span>
                        <span className="feed-strong">{score}</span>
                      </div>
                      <div className="feed-row">
                        <span>Rank</span>
                        <span className="feed-strong feed-red">{getRank(score)}</span>
                      </div>
                      <div className="feed-row">
                        <span>Top Score</span>
                        <span className="feed-strong">{topScores[0]?.score ?? 0}</span>
                      </div>
                      <div className="result-buttons">
                        <button className="retry-btn" onClick={startGame}>
                          Retry
                        </button>
                        <button className="title-btn" onClick={goToTitle}>
                          Title
                        </button>
                      </div>
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