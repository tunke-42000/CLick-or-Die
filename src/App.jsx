/* eslint-disable react-hooks/exhaustive-deps, react-hooks/purity */
import { useEffect, useMemo, useRef, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { ref, set, get, onValue, onDisconnect, update, remove, push, onChildAdded } from "firebase/database";
import { auth, db } from "./firebase";
import clockTick from "./clock-tick.mp3";

const KEYS = ["A", "S", "D", "F", "J", "K", "L", "Q", "W", "E", "R", "U", "I", "O", "P"];
const GAME_TIME = 40;
const STARTING_LIVES = 5;
const TOP_SCORES_KEY = "click-or-die-top3";
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
  const [battleHp, setBattleHp] = useState(60);
  const [attackGauge, setAttackGauge] = useState(0);

  const [gameMode, setGameMode] = useState("single");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [myRoomId, setMyRoomId] = useState("");

  const [myUid, setMyUid] = useState(null);
  const roomUnsubscribeRef = useRef(null);
  const attacksUnsubscribeRef = useRef(null);
  const myPlayerRef = useRef(null);

  const [opponentData, setOpponentData] = useState(null);
  const [opponentStatus, setOpponentStatus] = useState(null);
  const [opponentUid, setOpponentUid] = useState(null);

  const fakeJamChargesRef = useRef(0);
  const [hasShield, setHasShield] = useState(false);
  const [lastAttackSent, setLastAttackSent] = useState(null);
  const [lastDamageTaken, setLastDamageTaken] = useState(null);
  const [enemyHitAnim, setEnemyHitAnim] = useState(false);

  // New states for visual clarity
  const [battleLog, setBattleLog] = useState([]);
  const [centralNotice, setCentralNotice] = useState(null);

  const addLog = (text, type = "info") => {
    setBattleLog((prev) => {
      const next = [...prev, { id: Date.now() + Math.random(), text, type }];
      if (next.length > 5) return next.slice(next.length - 5);
      return next;
    });
  };

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
    if (attacksUnsubscribeRef.current) {
      attacksUnsubscribeRef.current();
      attacksUnsubscribeRef.current = null;
    }
    if (myPlayerRef.current) {
      remove(myPlayerRef.current).catch(() => {});
      myPlayerRef.current = null;
    }
  };

  const handleIncomingAttack = (type) => {
    setHasShield(currentShield => {
      if (currentShield) {
        setCentralNotice({ text: "BLOCKED", type: "good", subtext: "Enemy attack nullified" });
        addLog("Blocked Enemy Attack", "good");
        playFakeAvoidSound();
        return false;
      }
      
      switch(type) {
        case "light":
          setBattleHp(s => Math.max(0, s - 8));
          setMessage({ text: "UNDER ATTACK: LIGHT -8", type: "bad", id: Date.now() });
          setFlashType("trap");
          setLastDamageTaken("LIGHT ATTACK");
          setCentralNotice({ text: "LIGHT ATTACK HIT -8", type: "damage", subtext: "Enemy used Light Attack!" });
          addLog("Took 8 DMG from LIGHT ATTACK", "damage");
          break;
        case "fakejam":
          setBattleHp(s => Math.max(0, s - 12));
          fakeJamChargesRef.current += 2;
          setMessage({ text: "SYSTEM JAMMED: FAKE JAM", type: "bad", id: Date.now() });
          setFlashType("trap");
          setGlitchAnim(1);
          setLastDamageTaken("FAKE JAM");
          setCentralNotice({ text: "FAKE JAM HIT -12", type: "critical", subtext: "Next 2 keys are FAKE" });
          addLog("Took 12 DMG and 2 Fakes from FAKE JAM", "critical");
          break;
        default: break;
      }
      return currentShield;
    });
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
          setOpponentUid(null);
        } else {
          const enemyId = ids.find(p => p !== myUid);
          if (enemyId) {
            setOpponentUid(enemyId);
            const opData = players[enemyId];
            setOpponentData(opData);
            
            if (!matchTriggered) {
              matchTriggered = true;
              setOpponentStatus("matched");
              setMessage({ text: "OPPONENT FOUND!", id: Date.now() });
              
              setScore(0);
              setTimeLeft(GAME_TIME);
              timeLeftRef.current = GAME_TIME;
              setLives(STARTING_LIVES);
              setBattleHp(60);
              setAttackGauge(0);
              setCombo(0);
              setMaxCombo(0);
              setCorrectCount(0);
              setTotalReaction(0);
              setSuccessfulHits(0);
              fakeJamChargesRef.current = 0;
              setHasShield(false);
              setLastAttackSent(null);
              setLastDamageTaken(null);
              setBattleLog([]);
              setCentralNotice(null);

              setTimeout(() => {
                startGame();
              }, 1500);
            }
          }
        }
      });

      roomUnsubscribeRef.current = unsubscribe;

      const attacksRef = ref(db, `rooms/${validId}/attacks`);
      const unsubAttacks = onChildAdded(attacksRef, (snap) => {
        const attack = snap.val();
        if (attack && attack.to === myUid) {
          handleIncomingAttack(attack.type);
          remove(snap.ref).catch(() => {});
        }
      });
      attacksUnsubscribeRef.current = unsubAttacks;

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
    let fake = false;

    if (fakeJamChargesRef.current > 0) {
      fake = true;
      fakeJamChargesRef.current -= 1;
    }

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
    setBattleHp(60);
    setAttackGauge(0);
    setCombo(0);
    setMaxCombo(0);
    setCorrectCount(0);
    setTotalReaction(0);
    setSuccessfulHits(0);
    setMessage({ text: "PRESS THE KEY", id: Date.now() });
    setFlashType(null);
    setComboMsg(null);
    setResultSaved(false);
    setBattleLog([]);
    setCentralNotice(null);

    const firstKey = pickRandomKey();
    const firstFake = false;

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

  const clearTopScores = () => {
    localStorage.removeItem(TOP_SCORES_KEY);
    setTopScores([]);
  };

  const sendAttack = (type, msg) => {
    if (gameMode !== "multi" || !myRoomId || !opponentUid) return;
    
    const attacksRef = ref(db, `rooms/${myRoomId}/attacks`);
    push(attacksRef, {
      to: opponentUid,
      type: type,
      timestamp: Date.now()
    }).catch(() => {});

    setMessage({ text: msg, type: "good", id: Date.now() });
    
    const attackName = msg.split(": ")[1] || type.toUpperCase();
    setLastAttackSent(attackName);
    
    setCentralNotice({ text: attackName, type: "attack", subtext: "Attack Success!" });
    addLog(`You hit ${attackName}`, "attack");
    
    setEnemyHitAnim(true);
    setTimeout(() => setEnemyHitAnim(false), 500);
  };

  const manualAttackTrigger = () => {
    if (gameMode !== "multi" || attackGauge < 20) return;
    
    let type = "light";
    let cost = 20;
    let msg = "ATTACK SENT: LIGHT";

    if (attackGauge >= 100) {
      type = "shield";
      cost = 100;
      msg = "SHIELD DEPLOYED";
    } else if (attackGauge >= 60) {
      type = "fakejam";
      cost = 60;
      msg = "ATTACK SENT: FAKE JAM";
    } else if (attackGauge >= 20) {
      type = "light";
      cost = 20;
      msg = "ATTACK SENT: LIGHT ATTACK";
    }

    setAttackGauge(prev => Math.max(0, prev - cost));
    
    if (type === "shield") {
      setHasShield(true);
      setMessage({ text: msg, type: "good", id: Date.now() });
      setCentralNotice({ text: "SHIELD ON", type: "good", subtext: "Next attack blocked" });
      addLog("Deployed SHIELD", "good");
    } else {
      sendAttack(type, msg);
    }
  };

  const addGauge = (amount) => {
    if (gameMode === "multi") {
      setAttackGauge(prev => Math.max(0, Math.min(100, prev + amount)));
    }
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

    if (gameMode === "multi") {
      let g = 0;
      if (judgement.label === "PERFECT") g = 12;
      else if (judgement.label === "GREAT") g = 9;
      else if (judgement.label === "GOOD") g = 6;
      else g = 3;

      if (nextCombo >= 20) g += 3;
      else if (nextCombo >= 10) g += 2;
      else if (nextCombo >= 5) g += 1;

      addGauge(g);
    }

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
    if (gameMode === "multi") {
      setScore((prev) => Math.max(0, prev - 8));
      addGauge(-8);
      if (combo >= 5) setComboMsg({ text: "COMBO BREAK", type: "break", id: Date.now() });
      setCombo(0);
      playMissSound();
      setMessage({ text: "MISS", id: Date.now() });
      setFlashType("miss");
      spawnNextKey(currentKey);
      return;
    }

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
    if (gameMode === "multi") {
      setScore((prev) => Math.max(0, prev - 8));
      addGauge(-10);
      if (combo >= 5) setComboMsg({ text: "COMBO BREAK", type: "break", id: Date.now() });
      setCombo(0);
      playMissSound();
      setMessage({ text: "TRAP", id: Date.now() });
      setFlashType("trap");
      setGlitchAnim(Date.now());
      spawnNextKey(currentKey);
      return;
    }

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

      if (gameMode === "multi") {
        addGauge(8);
      }

      playFakeAvoidSound();
      setMessage({ text: "FAKE AVOID", id: Date.now() });
      setFlashType("fake-avoid");
      setAvoidedKey(currentKey);

      setTimeout(() => setAvoidedKey(null), 350);
      spawnNextKey(currentKey);
      return;
    }

    if (gameMode === "multi") {
      setScore((prev) => Math.max(0, prev - 8));
      addGauge(-8);
      if (combo >= 5) setComboMsg({ text: "COMBO BREAK", type: "break", id: Date.now() });
      setCombo(0);
      playMissSound();
      setMessage({ text: "TOO SLOW", id: Date.now() });
      setFlashType("miss");
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
      update(myPlayerRef.current, { 
        score, 
        battleHp, 
        attackGauge, 
        lives,
        hasShield,
        status: battleHp <= 0 ? "dead" : "alive" 
      }).catch(() => {});
    }
  }, [score, battleHp, attackGauge, lives, hasShield, gameMode, screen, myUid]);

  useEffect(() => {
    if (gameMode === "multi" && screen === "playing") {
      if (battleHp <= 0) {
        endGame();
      } else if (opponentData && opponentData.battleHp <= 0) {
        endGame();
      }
    }
  }, [battleHp, opponentData, screen, gameMode]);

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
    if (!centralNotice) return;
    const id = setTimeout(() => setCentralNotice(null), 2000);
    return () => clearTimeout(id);
  }, [centralNotice]);

  useEffect(() => {
    if (screen !== "playing") return;

    const onKeyDown = (e) => {
      if (e.repeat) return;

      if (e.code === "Space" && gameMode === "multi" && screen === "playing") {
        e.preventDefault();
        manualAttackTrigger();
        return;
      }

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

                <div className="title-actions" style={{ display: "flex", flexWrap: "wrap", gap: "16px", justifyContent: "center", marginTop: "40px" }}>
                  <button className="start-btn" onClick={() => { setGameMode("single"); setScreen("single_prep"); }}>
                    Single Play
                  </button>
                  <button className="start-btn multi-btn" onClick={() => { setGameMode("multi"); setScreen("room_input"); }} style={{ background: "#9333ea", borderColor: "#a855f7" }}>
                    Online Battle
                  </button>
                </div>
              </div>
            </div>
          )}

          {screen === "single_prep" && (
            <div className="center-screen">
              <div className="panel">
                <div className="warning">Mission Details</div>
                <h2 className="hero2" style={{ fontSize: "36px", marginBottom: "24px" }}>SINGLE PLAY</h2>

                <div className="stats2">
                  <StatCard label="Time" value={`${GAME_TIME}s`} />

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
                        <button 
                          className="title-btn" 
                          style={{ fontSize: 12, padding: "4px 8px", marginTop: "12px", width: "100%", opacity: 0.8 }} 
                          onClick={clearTopScores}
                        >
                          RESET RECORDS
                        </button>
                      </div>
                    ) : (
                      <div className="topscore-empty">No records yet</div>
                    )}
                  </div>
                </div>

                <div className="title-actions" style={{ display: "flex", gap: "16px", justifyContent: "center", marginTop: "24px" }}>
                  <button className="start-btn" style={{ flex: 1, minWidth: 0, padding: "18px 24px" }} onClick={() => startGame()}>
                    Start Mission
                  </button>
                  <button className="title-btn" style={{ flex: 1, minWidth: 0, padding: "18px 24px", fontSize: "16px" }} onClick={goToTitle}>
                    Back
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
                  <button className="start-btn multi-btn" style={{ flex: 1, minWidth: 0, padding: "18px 24px", background: "#9333ea", borderColor: "#a855f7" }} onClick={() => connectToRoom(roomIdInput)}>
                    Connect
                  </button>
                  <button className="title-btn" style={{ flex: 1, minWidth: 0, padding: "18px 24px", fontSize: "16px" }} onClick={goToTitle}>
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
              {gameMode === "multi" ? (
                <section className="vs-header">
                  {(() => {
                    const eHp = opponentData?.battleHp ?? 60;
                    const eGauge = opponentData?.attackGauge ?? 0;
                    let leadStatus = "EVEN";
                    let leadClass = "even";
                    if (battleHp > eHp) { leadStatus = "LEADING"; leadClass = "leading"; }
                    else if (battleHp < eHp) { leadStatus = "LOSING"; leadClass = "losing"; }
                    
                    const getNextAttackInfo = (gauge) => {
                      if (gauge >= 100) return { label: "SPACE: SHIELD", color: "#6ee7b7" };
                      if (gauge >= 60) return { label: "SPACE: FAKE JAM", color: "#d8b4fe" };
                      if (gauge >= 20) return { label: "SPACE: LIGHT ATTACK", color: "#93c5fd" };
                      return { label: "NEXT: LIGHT ATTACK", color: "#9ca3af" };
                    };
                    const getEnemyAttackInfo = (gauge) => {
                      if (gauge >= 100) return { label: "READY: SHIELD", color: "#6ee7b7" };
                      if (gauge >= 60) return { label: "READY: FAKE JAM", color: "#d8b4fe" };
                      if (gauge >= 20) return { label: "READY: LIGHT ATTACK", color: "#93c5fd" };
                      return { label: "NEXT: LIGHT ATTACK", color: "#9ca3af" };
                    };
                    const myAttackInfo = getNextAttackInfo(attackGauge);
                    const enemyAttackInfo = getEnemyAttackInfo(eGauge);

                    const getTierClass = (gauge) => gauge >= 100 ? 3 : gauge >= 60 ? 2 : gauge >= 20 ? 1 : 0;

                    return (
                      <>
                        <div className="vs-player">
                          <div className="vs-name">YOU</div>
                          <div className="vs-hp-bar">
                            {hasShield && <div className="shield-overlay" />}
                            <div className="vs-hp-fill" style={{ width: `${Math.max(0, Math.min(100, (battleHp/60)*100))}%`, background: battleHp <= 12 ? "#ef4444" : "#22c55e" }} />
                          </div>
                          <div className="vs-hp-val">{Math.max(0, battleHp)}</div>
                          <div className="vs-gauge-wrap">
                            <div className="vs-gauge-bg">
                              <div className={`vs-gauge-fill tier-${getTierClass(attackGauge)}`} style={{ width: `${Math.max(0, Math.min(100, attackGauge))}%` }} />
                              <div className="gauge-marker" style={{ left: "20%" }} />
                              <div className="gauge-marker" style={{ left: "60%" }} />
                            </div>
                            <div className="vs-gauge-label" style={{ color: myAttackInfo.color, textShadow: attackGauge >= 20 ? `0 0 10px ${myAttackInfo.color}` : "none" }}>{myAttackInfo.label}</div>
                          </div>
                        </div>
                        
                        <div className="vs-center">
                          <div className={`vs-time ${timeLeft <= 10 && screen === "playing" ? "danger" : ""}`}>{timeLeft}</div>
                          <div className={`vs-lead-status ${leadClass}`}>{leadStatus}</div>
                        </div>

                        <div className="vs-opponent">
                          <div className="vs-name" style={{ color: opponentStatus === "disconnected" ? "#9ca3af" : "#f87171" }}>
                            {opponentStatus === "disconnected" ? "ENEMY (OFFLINE)" : "ENEMY"}
                          </div>
                          <div className="vs-hp-bar">
                            {opponentData?.hasShield && <div className="shield-overlay enemy-shield" />}
                            <div className="vs-hp-fill enemy" style={{ width: `${Math.max(0, Math.min(100, (eHp/60)*100))}%`, background: eHp <= 12 ? "#ef4444" : "#22c55e" }} />
                          </div>
                          <div className="vs-hp-val">{Math.max(0, eHp)}</div>
                          <div className="vs-gauge-wrap" style={{ alignItems: "flex-end" }}>
                            <div className="vs-gauge-bg">
                              <div className={`vs-gauge-fill tier-${getTierClass(eGauge)} enemy`} style={{ width: `${Math.max(0, Math.min(100, eGauge))}%` }} />
                              <div className="gauge-marker" style={{ right: "20%" }} />
                              <div className="gauge-marker" style={{ right: "60%" }} />
                            </div>
                            <div className="vs-gauge-label" style={{ color: enemyAttackInfo.color, textShadow: eGauge >= 20 ? `0 0 10px ${enemyAttackInfo.color}` : "none" }}>{enemyAttackInfo.label}</div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </section>
              ) : (
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
              )}

              <section className="game-grid">
                <div className="arena">
                  <div
                    className={`arena-inner ${isDanger && screen === "playing" ? "danger" : ""} ${isZone ? "zone" : ""}`}
                  />

                  <div className="target-wrap">
                    {centralNotice && screen === "playing" && (
                      <div key={centralNotice.id} className={`central-notice ${centralNotice.type}`}>
                        <div className="central-notice-text">{centralNotice.text}</div>
                        {centralNotice.subtext && <div className="central-notice-sub">{centralNotice.subtext}</div>}
                      </div>
                    )}
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
                          <>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                              {(() => {
                                let title = "";
                                let titleColor = "#d1d5db";
                                let reason = "";
                                const eHp = opponentData?.battleHp || 0;
                                const eScore = opponentData?.score || 0;

                                if (opponentStatus === "disconnected") {
                                  title = "WIN"; titleColor = "#93c5fd"; reason = "Enemy disconnected";
                                } else if (battleHp <= 0) {
                                  title = "LOSE"; titleColor = "#ef4444"; reason = "Your Battle HP depleted";
                                } else if (eHp <= 0) {
                                  title = "WIN"; titleColor = "#fcd34d"; reason = "Enemy Battle HP depleted";
                                } else if (battleHp > eHp) {
                                  title = "WIN"; titleColor = "#fcd34d"; reason = "Higher HP at Time Up";
                                } else if (battleHp < eHp) {
                                  title = "LOSE"; titleColor = "#ef4444"; reason = "Lower HP at Time Up";
                                } else if (score > eScore) {
                                  title = "WIN"; titleColor = "#fcd34d"; reason = "Higher Score (HP was exact)";
                                } else if (score < eScore) {
                                  title = "LOSE"; titleColor = "#ef4444"; reason = "Lower Score (HP was exact)";
                                } else {
                                  title = "DRAW"; reason = "Same HP and Score";
                                }

                                return (
                                  <>
                                    <div className="rank-box" style={{ fontSize: "48px", color: titleColor, width: "auto", height: "auto", padding: "24px 48px", borderColor: titleColor, boxShadow: `0 0 30px ${titleColor}40` }}>
                                      {title}
                                    </div>
                                    <div style={{ fontSize: "16px", color: "#fca5a5", letterSpacing: "0.1em", textTransform: "uppercase" }}>{reason}</div>
                                  </>
                                );
                              })()}
                            </div>
                            <div className="multi-score-compare" style={{ display: "flex", gap: "32px", justifyContent: "center", marginTop: "16px" }}>
                              <div style={{ textAlign: "center" }}>
                                <div style={{ color: "#9ca3af", fontSize: "14px", letterSpacing: "0.1em" }}>YOU</div>
                                <div style={{ fontSize: "24px", color: "white", fontWeight: "bold" }}>HP: {Math.max(0, battleHp)}</div>
                                <div style={{ fontSize: "20px", color: "white" }}>PTS: {score}</div>
                              </div>
                              <div style={{ color: "#a855f7", fontSize: "24px", fontWeight: "bold", alignSelf: "center" }}>VS</div>
                              <div style={{ textAlign: "center" }}>
                                <div style={{ color: "#9ca3af", fontSize: "14px", letterSpacing: "0.1em" }}>ENEMY</div>
                                <div style={{ fontSize: "24px", color: "white", fontWeight: "bold" }}>HP: {Math.max(0, opponentData?.battleHp || 0)}</div>
                                <div style={{ fontSize: "20px", color: "white" }}>PTS: {opponentData?.score || 0}</div>
                              </div>
                            </div>
                          </>
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
                  
                  {gameMode === "multi" && screen === "playing" && (
                    <div className="battle-log-container">
                      {battleLog.map((log) => (
                        <div key={log.id} className={`log-entry log-${log.type}`}>
                          {log.text}
                        </div>
                      ))}
                    </div>
                  )}
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
                    <div className={`side-card opponent-card ${enemyHitAnim ? "enemy-hit-anim" : ""}`}>
                      <div className="side-title">Enemy Protocol</div>
                      <div className="feed-row" style={{ fontSize: "14px", marginTop: "4px" }}>
                        <span>Status: <span className={opponentStatus === "disconnected" || opponentData.status === "dead" ? "feed-red" : ""}>{opponentStatus === "disconnected" ? "OFFL" : opponentData.status === "dead" ? "DEAD" : "ALV"}</span></span>
                        <span>Score: <span className="feed-strong">{opponentData.score}</span></span>
                      </div>
                      
                      <div className="feed-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px", paddingBottom: "12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: "14px" }}>
                          <span>Battle HP</span>
                          <span className="feed-strong">{Math.max(0, opponentData.battleHp ?? 60)}</span>
                        </div>
                      </div>

                      <div style={{ borderTop: "1px solid rgba(168, 85, 247, 0.3)", paddingTop: "12px", fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#9ca3af" }}>Sent ATK:</span>
                          <span style={{ color: lastAttackSent ? "#fcd34d" : "#4b5563", maxWidth: '100px', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lastAttackSent || "NONE"}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#9ca3af" }}>Rcv'd ATK:</span>
                          <span style={{ color: lastDamageTaken ? "#ef4444" : "#4b5563", maxWidth: '100px', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lastDamageTaken || "NONE"}</span>
                        </div>
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