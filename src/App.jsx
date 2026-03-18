import { useEffect, useMemo, useRef, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { ref, set, get, onValue, onDisconnect, update, remove } from "firebase/database";
import { auth, db } from "./firebase";
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
  if (score >= 1400) return "Ω";
  if (score >= 1360) return "Z";
  if (score >= 1320) return "X";
  if (score >= 1280) return "SSS";
  if (score >= 1240) return "SS";
  if (score >= 1200) return "S";
  if (score >= 1160) return "A+";
  if (score >= 1120) return "A";
  if (score >= 1080) return "A-";
  if (score >= 1065) return "B+";
  if (score >= 1050) return "B";
  if (score >= 1020) return "B-";
  if (score >= 990) return "C+";
  if (score >= 960) return "C";
  if (score >= 930) return "C-";
  if (score >= 890) return "D+";
  if (score >= 850) return "D";
  if (score >= 820) return "D-";
  if (score >= 780) return "E+";
  if (score >= 730) return "E";
  return "E-";
}

function getNextRankInfo(score) {
  const rankTable = [
    { min: 1400, rank: "Ω" },
    { min: 1360, rank: "Z" },
    { min: 1320, rank: "X" },
    { min: 1280, rank: "SSS" },
    { min: 1240, rank: "SS" },
    { min: 1200, rank: "S" },
    { min: 1160, rank: "A+" },
    { min: 1120, rank: "A" },
    { min: 1080, rank: "A-" },
    { min: 1065, rank: "B+" },
    { min: 1050, rank: "B" },
    { min: 1020, rank: "B-" },
    { min: 990, rank: "C+" },
    { min: 960, rank: "C" },
    { min: 930, rank: "C-" },
    { min: 890, rank: "D+" },
    { min: 850, rank: "D" },
    { min: 820, rank: "D-" },
    { min: 780, rank: "E+" },
    { min: 730, rank: "E" },
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
    ctx.resume().catch(() => { });
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
    ctx.resume().catch(() => { });
  }

  playTone({ frequency: 440, duration: 0.05, type: "sine", volume: 0.025 });
  setTimeout(() => playTone({ frequency: 660, duration: 0.06, type: "sine", volume: 0.025 }), 90);
  setTimeout(() => playTone({ frequency: 880, duration: 0.08, type: "sine", volume: 0.03 }), 180);
}

function playGameOverSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => { });
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

function playFakeAvoidSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => { });
  }

  // A fast, rising digital sweep to feel like "hacked avoided" or "trap evaded"
  playTone({ frequency: 600, sweepTo: 1200, duration: 0.06, type: "square", volume: 0.025 });
  setTimeout(() => playTone({ frequency: 1200, sweepTo: 2400, duration: 0.08, type: "sine", volume: 0.025 }), 60);
}

function playMilestoneSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => { });
  }

  playTone({ frequency: 880, sweepTo: 1760, duration: 0.1, type: "sine", volume: 0.035 });
  setTimeout(() => playTone({ frequency: 1320, sweepTo: 2640, duration: 0.15, type: "sine", volume: 0.035 }), 120);
}

export default function App() {
  const [screen, setScreen] = useState("title");

  // Initial connection test removed

  const [countdown, setCountdown] = useState(3);

  const [score, setScore] = useState(0);
  const [topScores, setTopScores] = useState([]);
  const [resultSaved, setResultSaved] = useState(false);
  const [timeLeft, setTimeLeft] = useState(GAME_TIME);
  const [lives, setLives] = useState(STARTING_LIVES);

  const [gameMode, setGameMode] = useState("single");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [myRoomId, setMyRoomId] = useState("");

  const [myUid, setMyUid] = useState(null);
  const roomUnsubscribeRef = useRef(null);
  const myPlayerRef = useRef(null);

  const [opponentData, setOpponentData] = useState(null);
  const [opponentStatus, setOpponentStatus] = useState(null);

  useEffect(() => {
    signInAnonymously(auth)
      .then((cred) => setMyUid(cred.user.uid))
      .catch((err) => console.error("Firebase Login Failed:", err));
  }, []);

  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  const [currentKey, setCurrentKey] = useState("");
  const [reactionStart, setReactionStart] = useState(0);
  const [totalReaction, setTotalReaction] = useState(0);
  const [successfulHits, setSuccessfulHits] = useState(0);
  const [isFake, setIsFake] = useState(false);
  const [avoidedKey, setAvoidedKey] = useState(null);

  const [message, setMessage] = useState({ text: "SYSTEM IDLE", id: 0 });
  const [flashType, setFlashType] = useState(null);
  const [comboMsg, setComboMsg] = useState(null);
  const [spawnId, setSpawnId] = useState(0);
  const [glitchAnim, setGlitchAnim] = useState(0);

  const roundTimeoutRef = useRef(null);
  const globalTimerRef = useRef(null);
  const tickAudioRef = useRef(null);
  const timeLeftRef = useRef(GAME_TIME);

  const avgReaction = successfulHits > 0 ? Math.round(totalReaction / successfulHits) : 0;
  const roundWindow = useMemo(() => getRoundWindow(correctCount), [correctCount]);

  const actualRoundWindow = useMemo(() => {
    return isFake ? Math.max(450, roundWindow - 250) : roundWindow;
  }, [isFake, roundWindow]);

  const nextRankInfo = getNextRankInfo(score);

  const cleanupRoom = () => {
    if (roomUnsubscribeRef.current) {
      roomUnsubscribeRef.current();
      roomUnsubscribeRef.current = null;
    }
    if (myPlayerRef.current) {
      remove(myPlayerRef.current).catch(() => {});
      myPlayerRef.current = null;
    }
  };

  const connectToRoom = async (id) => {
    if (!id.trim() || !myUid) return;
    
    const validId = id.toUpperCase();
    setGameMode("multi");
    setMyRoomId(validId);
    setOpponentData(null);
    setOpponentStatus("waiting");
    setScreen("room_wait");
    setMessage({ text: "CONNECTING...", id: Date.now() });

    cleanupRoom();

    const roomRef = ref(db, `rooms/${validId}`);
    try {
      const snapshot = await get(roomRef);
      let currentPlayers = {};
      if (snapshot.exists()) {
        const data = snapshot.val();
        currentPlayers = data.players || {};
      }

      const playerIds = Object.keys(currentPlayers);
      if (playerIds.length >= 2 && !playerIds.includes(myUid)) {
        setMessage({ text: "ROOM IS FULL", id: Date.now() });
        setScreen("room_input");
        return;
      }

      const playerRef = ref(db, `rooms/${validId}/players/${myUid}`);
      myPlayerRef.current = playerRef;
      
      onDisconnect(playerRef).remove();
      await set(playerRef, { score: 0, lives: STARTING_LIVES, status: "alive" });

      let matchTriggered = false;
      const unsubscribe = onValue(roomRef, (snap) => {
        const data = snap.val();
        if (!data || !data.players || !data.players[myUid]) {
          setOpponentStatus("disconnected");
          return;
        }

        const players = data.players;
        const ids = Object.keys(players);
        
        if (ids.length < 2) {
          setOpponentStatus("waiting");
          if (matchTriggered) {
             setOpponentStatus("disconnected");
          } else {
             setMessage({ text: "WAITING FOR OPPONENT", id: Date.now() });
          }
          setOpponentData(null);
        } else {
          const opponentId = ids.find(p => p !== myUid);
          if (opponentId) {
            const opData = players[opponentId];
            setOpponentData(opData);
            
            if (!matchTriggered) {
              matchTriggered = true;
              setOpponentStatus("matched");
              setMessage({ text: "OPPONENT FOUND!", id: Date.now() });
              
              setScore(0);
              setTimeLeft(GAME_TIME);
              timeLeftRef.current = GAME_TIME;
              setLives(STARTING_LIVES);
              setCombo(0);
              setMaxCombo(0);
              setCorrectCount(0);
              setTotalReaction(0);
              setSuccessfulHits(0);

              setTimeout(() => {
                startGame();
              }, 1500);
            }
          }
        }
      });

      roomUnsubscribeRef.current = unsubscribe;
    } catch (error) {
      console.error(error);
      setMessage({ text: "CONNECTION FAILED", id: Date.now() });
      setScreen("room_input");
    }
  };

  const handleRematch = () => {
    connectToRoom(myRoomId);
  };

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
    setSpawnId(Date.now());
  };

  const beginPlay = () => {
    setScore(0);
    setTimeLeft(GAME_TIME);
    timeLeftRef.current = GAME_TIME;
    setLives(STARTING_LIVES);
    setCombo(0);
    setMaxCombo(0);
    setCorrectCount(0);
    setTotalReaction(0);
    setSuccessfulHits(0);
    setMessage({ text: "PRESS THE KEY", id: Date.now() });
    setFlashType(null);
    setComboMsg(null);
    setResultSaved(false);

    const firstKey = pickRandomKey();
    const firstFake = Math.random() < FAKE_KEY_CHANCE;

    setCurrentKey(firstKey);
    setIsFake(firstFake);
    setReactionStart(Date.now());
    setSpawnId(Date.now());
    setScreen("playing");
  };

  const startGame = () => {
    clearAllTimers();
    stopTickSound();
    playStartSound();
    setCountdown(3);
    setCurrentKey("");
    setIsFake(false);
    setMessage({ text: "SYSTEM ARMED", id: Date.now() });
    setFlashType(null);
    setScreen("countdown");
  };

  const endGame = () => {
    clearAllTimers();
    stopTickSound();
    playGameOverSound();
    setCurrentKey("");
    setIsFake(false);
    setMessage({ text: "SYSTEM FAILURE", id: Date.now() });
    setScreen("result");
  };

  const goToTitle = () => {
    cleanupRoom();
    clearAllTimers();
    stopTickSound();
    setCurrentKey("");
    setIsFake(false);
    setMessage({ text: "SYSTEM IDLE", id: Date.now() });
    setFlashType(null);
    setScreen("title");
  };

  const handleCorrect = () => {
    const isRush = timeLeftRef.current <= 10;
    const rushMultiplier = isRush ? 1.5 : 1;

    const reaction = Date.now() - reactionStart;
    const nextCombo = combo + 1;
    const judgement = getJudgement(reaction);

    // Uncapped combo points, max +15
    const baseComboBonus = Math.min(15, Math.floor(nextCombo / 2));
    const baseGained = 6 + baseComboBonus + judgement.bonus;
    let gained = Math.floor(baseGained * rushMultiplier);

    if (nextCombo > 0 && nextCombo % 10 === 0) {
      gained += 50;
    }

    setScore((prev) => prev + gained);
    setCombo(nextCombo);
    setMaxCombo((prev) => Math.max(prev, nextCombo));
    setCorrectCount((prev) => prev + 1);
    setTotalReaction((prev) => prev + reaction);
    setSuccessfulHits((prev) => prev + 1);

    if (nextCombo > 0) {
      if (nextCombo % 10 === 0) {
        setComboMsg({ text: `${nextCombo} COMBO! +50`, type: "milestone", id: Date.now() });
        playMilestoneSound();
      } else if (nextCombo >= 2) {
        setComboMsg({ text: `${nextCombo} COMBO`, type: "normal", id: Date.now() });
      }
    }

    playSuccessSound();
    setMessage({ text: judgement.label, id: Date.now() });
    setFlashType("success");
    spawnNextKey(currentKey);
  };

  const handleWrong = () => {
    setScore((prev) => Math.max(0, prev - 6));
    if (combo >= 5) setComboMsg({ text: "COMBO BREAK", type: "break", id: Date.now() });
    setCombo(0);
    playMissSound();
    setMessage({ text: "MISS", id: Date.now() });
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
    setMessage({ text: "TRAP", id: Date.now() });
    setFlashType("trap");
    setGlitchAnim(Date.now());

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
      const isRush = timeLeftRef.current <= 10;
      const rushMultiplier = isRush ? 1.5 : 1;

      const nextCombo = combo + 1;
      const baseComboBonus = Math.min(15, Math.floor(nextCombo / 2));
      const baseGained = 10 + baseComboBonus;
      let gained = Math.floor(baseGained * rushMultiplier);

      if (nextCombo > 0 && nextCombo % 10 === 0) {
        gained += 50;
      }

      setScore((prev) => prev + gained);
      setCombo(nextCombo);
      setMaxCombo((prev) => Math.max(prev, nextCombo));
      setCorrectCount((prev) => prev + 1);

      if (nextCombo > 0) {
        if (nextCombo % 10 === 0) {
          setComboMsg({ text: `${nextCombo} COMBO! +50`, type: "milestone", id: Date.now() });
          playMilestoneSound();
        } else if (nextCombo >= 2) {
          setComboMsg({ text: `${nextCombo} COMBO`, type: "normal", id: Date.now() });
        }
      }

      playFakeAvoidSound();
      setMessage({ text: "FAKE AVOID", id: Date.now() });
      setFlashType("fake-avoid");
      setAvoidedKey(currentKey);

      setTimeout(() => setAvoidedKey(null), 350);
      spawnNextKey(currentKey);
      return;
    }

    if (combo >= 5) setComboMsg({ text: "COMBO BREAK", type: "break", id: Date.now() });
    setCombo(0);
    playMissSound();
    setMessage({ text: "TOO SLOW", id: Date.now() });
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
    if (gameMode === "multi" && screen === "playing" && myPlayerRef.current && myUid) {
      update(myPlayerRef.current, { score, lives, status: lives <= 0 ? "dead" : "alive" }).catch(() => {});
    }
  }, [score, lives, gameMode, screen, myUid]);

  useEffect(() => {
    if (screen === "playing" && gameMode === "multi" && opponentStatus === "disconnected") {
      setMessage({ text: "OPPONENT DISCONNECTED", id: Date.now() });
      setTimeout(() => endGame(), 1500);
    }
  }, [opponentStatus, screen, gameMode]);

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
    if (screen !== "result" || resultSaved || gameMode === "multi") return;
    setTopScores((prev) => updateTopScores(prev, score));
    setResultSaved(true);
  }, [screen, score, resultSaved, gameMode]);

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
      setTimeLeft((prev) => {
        const next = prev - 1;
        timeLeftRef.current = next;
        return next;
      });
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
      audio.play().catch(() => { });
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
  const isRushTime = screen === "playing" && timeLeft <= 10;
  const isZone = combo >= 20;

  const getMessageClass = (text) => {
    if (text === "PERFECT") return "msg-perfect";
    if (text === "GREAT") return "msg-great";
    if (text === "GOOD") return "msg-good";
    if (text === "SLOW" || text === "TOO SLOW") return "msg-slow";
    if (text === "MISS" || text === "SYSTEM FAILURE") return "msg-miss";
    if (text === "TRAP") return "msg-trap";
    if (text === "FAKE AVOID") return "msg-fake-avoid";
    return "msg-default";
  };

  const shouldBump = message.text === "PERFECT" || message.text === "GREAT";

  return (
    <div
      className={`app ${glitchAnim ? "glitch-shake" : ""}`}
      onAnimationEnd={(e) => {
        if (e.animationName === "appGlitchShake") setGlitchAnim(0);
      }}
    >
      {flashType && <div className={`flash ${flashType}`} />}

      <div className="shell">
        <header className="header">
          <div>
            <div className={`eyebrow ${isRushTime ? "rush" : ""}`}>
              {isRushTime ? "FINAL RUSH // SCORE x1.5" : "Emergency Input Protocol"}
            </div>
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

                <div className="title-actions" style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
                  <button className="start-btn" onClick={() => { setGameMode("single"); startGame(); }}>
                    Single Play
                  </button>
                  <button className="start-btn multi-btn" onClick={() => setScreen("room_input")} style={{ background: "#9333ea", borderColor: "#a855f7" }}>
                    Online Battle
                  </button>
                </div>
              </div>
            </div>
          )}

          {screen === "room_input" && (
            <div className="center-screen">
              <div className="panel room-panel">
                <div className="warning">Online Protocol</div>
                <h2 className="hero2" style={{ fontSize: "48px" }}>ROOM ACCESS</h2>
                <input
                  type="text"
                  className="room-input"
                  placeholder="Enter Room ID"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value)}
                  maxLength={10}
                />
                <div className="room-actions" style={{ marginTop: 24, display: "flex", gap: 16, justifyContent: "center" }}>
                  <button className="start-btn multi-btn" style={{ background: "#9333ea", borderColor: "#a855f7" }} onClick={() => connectToRoom(roomIdInput)}>
                    Connect
                  </button>
                  <button className="title-btn" onClick={goToTitle}>
                    Back
                  </button>
                </div>
              </div>
            </div>
          )}

          {screen === "room_wait" && (
            <div className="center-screen">
              <div className="panel room-panel">
                <div className="warning">Connection</div>
                <h2 className="hero2" style={{ fontSize: "36px" }}>{opponentStatus === "matched" ? "MATCHED!" : "WAITING..."}</h2>
                <div className="room-id-display" style={{ fontSize: 24, letterSpacing: '0.2em' }}>Room ID: <span style={{ color: "#fcd34d" }}>{myRoomId}</span></div>

                {opponentStatus === "waiting" && (
                  <div style={{ marginTop: 32 }}>
                    <button className="title-btn" onClick={goToTitle}>
                      Cancel
                    </button>
                  </div>
                )}
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
                    className={`arena-inner ${isDanger && screen === "playing" ? "danger" : ""} ${isZone ? "zone" : ""}`}
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
                      <div className="key-box-wrapper">
                        <div
                          key={spawnId}
                          className={`key-box ${isFake ? "fake" : ""} ${shouldBump ? "bump-anim" : ""}`}
                          data-text={currentKey}
                        >
                          {currentKey}
                        </div>
                        {avoidedKey && (
                          <div
                            className="key-box fake avoided-anim"
                            data-text={avoidedKey}
                          >
                            {avoidedKey}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="key-box-wrapper">
                        {gameMode === "multi" ? (
                          <div className="rank-box" style={{ fontSize: "48px", color: opponentStatus === "disconnected" ? "#93c5fd" : score > (opponentData?.score || 0) ? "#fcd34d" : score < (opponentData?.score || 0) ? "#ef4444" : "#d1d5db" }}>
                            {opponentStatus === "disconnected" ? "WIN" :
                              score > (opponentData?.score || 0) ? "WIN" :
                                score < (opponentData?.score || 0) ? "LOSE" : "DRAW"}
                          </div>
                        ) : (
                          <div className="rank-box">{getRank(score)}</div>
                        )}
                      </div>
                    )}

                    <div className={`status-text ${getMessageClass(message.text)}`} key={message.id}>
                      {screen === "playing" ? message.text : "Final Rank"}
                    </div>

                    {screen === "playing" && (
                      <div className="window-wrap">
                        <div className="window-head">
                          <span>入力制限時間</span>
                          <span>{(actualRoundWindow / 1000).toFixed(1)}s</span>
                        </div>
                        <div className="window-bar">
                          <div
                            className={`window-fill ${actualRoundWindow <= 1400 ? "danger" : ""
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

                  {screen === "playing" && gameMode === "single" && (
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

                  {gameMode === "multi" && opponentData && (
                    <div className="side-card opponent-card">
                      <div className="side-title">Enemy Protocol</div>
                      <div className="feed-row">
                        <span>Score</span>
                        <span className="feed-strong">{opponentData.score}</span>
                      </div>
                      <div className="feed-row">
                        <span>HP</span>
                        <span className="feed-strong opponent-hp" style={{ letterSpacing: "0.05em", fontSize: "18px" }}>{"💛".repeat(Math.max(0, opponentData.lives))}</span>
                      </div>
                      <div className="feed-row">
                        <span>Status</span>
                        <span className={`feed-strong ${opponentStatus === "disconnected" || opponentData.status === "dead" ? "feed-red" : ""}`}>
                          {opponentStatus === "disconnected" ? "OFFLINE" : opponentData.status === "dead" ? "DEAD" : "ALIVE"}
                        </span>
                      </div>
                    </div>
                  )}

                  {screen === "result" && (
                    <div className="side-card">
                      <div className="side-title">System Report</div>
                      <div className="feed-row">
                        <span>My Score</span>
                        <span className="feed-strong">{score}</span>
                      </div>

                      {gameMode === "single" ? (
                        <>
                          <div className="feed-row">
                            <span>Rank</span>
                            <span className="feed-strong feed-red">{getRank(score)}</span>
                          </div>
                          <div className="feed-row">
                            <span>Top Score</span>
                            <span className="feed-strong">{topScores[0]?.score ?? 0}</span>
                          </div>
                        </>
                      ) : (
                        <div className="feed-row">
                          <span>Enemy Score</span>
                          <span className="feed-strong feed-red">{opponentData?.score || 0}</span>
                        </div>
                      )}

                      <div className="result-buttons">
                        <button className="retry-btn" onClick={gameMode === "multi" ? handleRematch : startGame}>
                          {gameMode === "multi" ? "Rematch" : "Retry"}
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