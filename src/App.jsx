/* eslint-disable react-hooks/exhaustive-deps, react-hooks/purity */
import { useEffect, useMemo, useRef, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { ref, set, get, onValue, onDisconnect, update, remove, push, onChildAdded, serverTimestamp } from "firebase/database";
import { auth, db } from "./firebase";
import clockTick from "./clock-tick.mp3";

const KEYS = ["A", "S", "D", "F", "J", "K", "L", "Q", "W", "E", "R", "U", "I", "O", "P"];
const GAME_TIME = 60;
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

const TUTORIAL_STEPS = [
  { title: "WELCOME TO CLICK OR DIE", lines: ["オンラインバトルの基本ルールを", "順番に体験しながら学びます"] },
  { title: "STEP 1 / BASIC INPUT", lines: ["中央に表示されたキーを押してください", "まずは3回成功させましょう"] },
  { title: "STEP 2 / FAKE KEY", lines: ["通常キーは押し、紫の異常なキー(FAKE)は", "押さずにやり過ごしてください", "FAKE を3回正しく無視できればクリアです"] },
  { title: "STEP 3 / BATTLE RULE", lines: ["オンラインでは HP を削り合います", "相手より有利な状態で終われば勝利です"] },
  { title: "STEP 4 / ATTACK GAUGE", lines: ["正確に入力すると ATTACK GAUGE が貯まります", "このゲージを使って攻撃や防御を行います"] },
  { title: "STEP 5 / LIGHT ATTACK", lines: ["ゲージが20以上あると LIGHT ATTACK が使えます", "SPACEキーを押して発動してみましょう"] },
  { title: "STEP 6 / FAKE JAM", lines: ["FAKE JAM は相手の妨害攻撃です", "次に降ってくる2回のキーが紫のFAKEに化けます", "画面に「FAKE JAM INCOMING」と出たら警戒しましょう"] },
  { title: "STEP 7 / SHIELD ARMOR", lines: ["最大ゲージの SHIELD ARMOR は永続バフの最上位技です", "10ダメージを与え、自身の被ダメージを永続で8%軽減します", "重ね掛けで最大40%まで防御を強化できます。使ってみましょう"] },
  { title: "STEP 8 / WIN CONDITIONS", lines: ["これで全スキルの説明は終わりです", "・正確に早くキーを押してゲージを貯める", "・攻撃や妨害で相手のHPを削る", "・永続バリア(ARMOR)で身を守りつつ戦う", "以上の戦術を駆使して勝利しましょう"] },
  { title: "STEP 9 / PRACTICE BATTLE", lines: ["最後に練習試合をしてみましょう", "学んだ操作を使って勝利を目指してください"] },
];

export default function App() {
  const [screen, setScreen] = useState("title");

  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialPhase, setTutorialPhase] = useState("intro");
  const [tutorialTarget, setTutorialTarget] = useState(0);

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
  const [shieldStacks, setShieldStacks] = useState(0);
  const [shieldBreakAnim, setShieldBreakAnim] = useState(false);
  const [shieldActivateAnim, setShieldActivateAnim] = useState(false);
  const [showSkull, setShowSkull] = useState(false);
  const [lastAttackSent, setLastAttackSent] = useState(null);
  const [lastDamageTaken, setLastDamageTaken] = useState(null);
  const [enemyHitAnim, setEnemyHitAnim] = useState(false);

  // New states for visual clarity
  const [battleLog, setBattleLog] = useState([]);
  const [centralNotice, setCentralNotice] = useState(null);

  const addBattleLog = (type, text) => {
    setBattleLog((prev) => {
      const newLogs = [...prev, { id: Date.now() + Math.random(), type, text }].slice(-3);
      return newLogs;
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
      if (myRoomId) {
        update(ref(db, `rooms/${myRoomId}`), { matchState: "waiting" }).catch(() => { });
      }
      remove(myPlayerRef.current).catch(() => { });
      myPlayerRef.current = null;
    }
    setMyRoomId("");
    setOpponentUid(null);
    setOpponentData(null);
  };

  const handleIncomingAttack = (type) => {
    const getReducedDamage = (baseDamage) => {
      const reduction = Math.min(shieldStacks * 0.08, 0.40);
      return Math.max(1, Math.ceil(baseDamage * (1 - reduction)));
    };

    switch (type) {
      case "light":
        const dmgLight = getReducedDamage(8);
        setEnemyHitAnim(true);
        setTimeout(() => setEnemyHitAnim(false), 500);
        setBattleHp(s => Math.max(0, s - dmgLight));
        setMessage({ text: `UNDER ATTACK: LIGHT -${dmgLight}`, type: "bad", id: Date.now() });
        setFlashType("trap");
        setLastDamageTaken("LIGHT ATTACK");
        setCentralNotice({ text: `LIGHT ATTACK HIT -${dmgLight}`, type: "damage", subtext: "Enemy used Light Attack!" });
        addBattleLog("damage", `Took ${dmgLight} DMG from LIGHT ATTACK`);
        break;
      case "shield_attack":
        const dmgShield = getReducedDamage(10);
        setEnemyHitAnim(true);
        setTimeout(() => setEnemyHitAnim(false), 500);
        setBattleHp(s => Math.max(0, s - dmgShield));
        setMessage({ text: `UNDER ATTACK: SHIELD -${dmgShield}`, type: "bad", id: Date.now() });
        setFlashType("trap");
        setLastDamageTaken("SHIELD STRIKE");
        setCentralNotice({ text: `ARMOR ATK HIT -${dmgShield}`, type: "damage", subtext: "Enemy deployed shield!" });
        addBattleLog("damage", `Took ${dmgShield} DMG from SHIELD STRIKE`);
        break;
      case "fakejam":
        const dmgJam = getReducedDamage(12);
        setBattleHp(s => Math.max(0, s - dmgJam));
        fakeJamChargesRef.current += 2;
        setMessage({ text: `SYSTEM JAMMED: FAKE JAM -${dmgJam}`, type: "bad", id: Date.now() });
        setFlashType("trap");
        setGlitchAnim(1);
        setLastDamageTaken("FAKE JAM");
        setCentralNotice({ text: `FAKE JAM HIT -${dmgJam}`, type: "critical", subtext: "Next 2 keys are FAKE" });
        addBattleLog("critical", `Took ${dmgJam} DMG and 2 Fakes from FAKE JAM`);

        setShowSkull(true);
        setTimeout(() => setShowSkull(false), 1000);
        break;
    }
  };

  const connectToRoom = async (id) => {
    if (!id.trim() || !myUid) return;

    const validId = id.toUpperCase();
    cleanupRoom();

    setGameMode("multi");
    setMyRoomId(validId);
    setOpponentData(null);
    setOpponentStatus("waiting");
    setScreen("room_wait");

    const roomRef = ref(db, `rooms/${validId}`);
    try {
      const snapshot = await get(roomRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        const ps = data.players || {};
        let validOpponents = 0;
        for (const pid of Object.keys(ps)) {
          if (pid !== myUid) {
            const p = ps[pid];
            if (p.connected && ["waiting", "ready", "playing", "alive", "dead"].includes(p.status)) {
              validOpponents++;
            } else {
              remove(ref(db, `rooms/${validId}/players/${pid}`)).catch(() => { });
            }
          }
        }
        if (validOpponents >= 1) {
          if (validOpponents >= 2) {
            setMessage({ text: "ROOM IS FULL", type: "bad", id: Date.now() });
            setScreen("room_input");
            return;
          }
        } else {
          await update(roomRef, { matchState: "waiting" }).catch(() => { });
        }
      } else {
        await set(roomRef, { matchState: "waiting" }).catch(() => { });
      }

      const playerRef = ref(db, `rooms/${validId}/players/${myUid}`);
      myPlayerRef.current = playerRef;

      onDisconnect(playerRef).remove();
      await update(playerRef, {
        uid: myUid,
        score: 0,
        battleHp: 60,
        attackGauge: 0,
        lives: STARTING_LIVES,
        status: "waiting",
        shieldStacks: 0,
        connected: true,
        joinedAt: serverTimestamp()
      });

      let matchTriggered = false;
      const unsubscribe = onValue(roomRef, (snap) => {
        const data = snap.val();
        if (!data || !data.players || !data.players[myUid]) {
          setOpponentStatus("disconnected");
          return;
        }

        const ms = data.matchState || "waiting";
        const players = data.players;
        const ids = Object.keys(players);
        const myData = players[myUid];

        const validEnemyId = ids.find(p => p !== myUid && players[p].connected && ["waiting", "ready", "playing", "alive", "dead"].includes(players[p].status));

        if (!validEnemyId) {
          setOpponentStatus("waiting");
          if (matchTriggered) {
            setOpponentStatus("disconnected");
          } else {
            setMessage({ text: "WAITING FOR OPPONENT", id: Date.now() });
          }
          setOpponentData(null);
          setOpponentUid(null);
        } else {
          setOpponentUid(validEnemyId);
          const opData = players[validEnemyId];
          setOpponentData(opData);
          setOpponentStatus(opData.status);

          if (!matchTriggered) {
            if (ms === "waiting") {
              if (myData.status === "waiting") {
                update(playerRef, { status: "ready" }).catch(() => { });
              }
              if (myData.status === "ready" && opData.status === "ready") {
                if (myUid < validEnemyId) {
                  update(roomRef, { matchState: "countdown" }).catch(() => { });
                }
              }
            }

            if (ms === "countdown") {
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
              setShieldStacks(0);
              setShieldBreakAnim(false);
              setShieldActivateAnim(false);
              setShowSkull(false);
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
          remove(snap.ref).catch(() => { });
        }
      });
      attacksUnsubscribeRef.current = unsubAttacks;

    } catch (error) {
      console.error(error);
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
    if (fakeJamChargesRef.current > 0) {
      fakeJamChargesRef.current -= 1;
      setIsFake(true);
    } else if (gameMode === "tutorial" && tutorialPhase === "play" && tutorialStep === 2) {
      // 30% chance for Fake, but don't spawn consecutive fakes to keep it fair and balanced
      if (isFake) {
        setIsFake(false);
      } else {
        setIsFake(Math.random() < 0.35);
      }
    } else {
      setIsFake(false);
    }
    setCurrentKey(next);
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
    fakeJamChargesRef.current = 0;
    setShieldStacks(0);
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

  const advanceTutorial = () => {
    const next = tutorialStep + 1;
    if (next >= TUTORIAL_STEPS.length) {
      setScreen("tutorial_complete");
      return;
    }
    setTutorialStep(next);
    setTutorialPhase("intro");
    setTutorialTarget(0);
    setScore(0);
    setBattleHp(60);
    setAttackGauge(0);
    setShieldStacks(0);
    fakeJamChargesRef.current = 0;
    setOpponentData({ battleHp: 60, attackGauge: 0, shieldStacks: 0, fakeJamCharges: 0, score: 0 });
    if (next === 5) setAttackGauge(20);
    if (next === 6) setAttackGauge(0);
    if (next === 7) setAttackGauge(100);
    if (next === 9) {
      setTimeLeft(GAME_TIME);
      timeLeftRef.current = GAME_TIME;
    } else {
      setTimeLeft(999);
      timeLeftRef.current = 999;
    }
    setCurrentKey("");
    setIsFake(false);
  };

  const startTutorialPhase = () => {
    setTutorialTarget(0);
    if (tutorialStep === 1 || tutorialStep === 4 || tutorialStep === 9) {
      setTutorialPhase("play");
      spawnNextKey();
    } else if (tutorialStep === 2) {
      setTutorialPhase("play");
      setIsFake(false); // Start with a safe key
      spawnNextKey();
    } else if (tutorialStep === 6) {
      setTutorialPhase("enemy_fakejam_attack");
      setTimeout(() => {
        setCentralNotice({ text: "妨害を受けました", type: "critical", subtext: "ENEMY USED FAKE JAM" });
        handleIncomingAttack("fakejam");
        setTimeout(() => {
          setTutorialPhase("fake_key_active");
          setCentralNotice({ text: "FAKE JAM INCOMING", type: "critical", subtext: "このキーは押さない！" });
          spawnNextKey(); // generates first fake key due to jam charges
        }, 1500);
      }, 1000);
    } else if (tutorialStep === 5 || tutorialStep === 7) {
      setTutorialPhase("play");
      setCurrentKey("");
    }
  };

  const goToTitle = () => {
    cleanupRoom();
    clearAllTimers();
    stopTickSound();
    setCurrentKey("");
    setIsFake(false);
    setTutorialStep(0);
    setTutorialPhase("intro");
    setMessage({ text: "SYSTEM IDLE", id: Date.now() });
    setFlashType(null);
    setScreen("title");
  };

  const startTutorial = () => {
    setGameMode("tutorial");
    setTutorialStep(0);
    setTutorialPhase("intro");
    setScore(0);
    setTimeLeft(999);
    timeLeftRef.current = 999;
    setLives(STARTING_LIVES);
    setBattleHp(60);
    setAttackGauge(0);
    setCombo(0);
    setMaxCombo(0);
    setCorrectCount(0);
    setTotalReaction(0);
    setSuccessfulHits(0);
    fakeJamChargesRef.current = 0;
    setShieldStacks(0);
    setBattleLog([]);
    setCentralNotice(null);
    setOpponentData({ battleHp: 60, attackGauge: 0, shieldStacks: 0, fakeJamCharges: 0, score: 0 });
    setOpponentStatus("matched");
    setScreen("tutorial");
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
    }).catch(() => { });

    setMessage({ text: msg, type: "good", id: Date.now() });

    const attackName = msg.split(": ")[1] || type.toUpperCase();
    setLastAttackSent(attackName);

    setCentralNotice({ text: attackName, type: "attack", subtext: "Attack Success!" });
    addBattleLog("attack", `You hit ${attackName}`);

    setEnemyHitAnim(true);
    setTimeout(() => setEnemyHitAnim(false), 500);
  };

  const manualAttackTrigger = () => {
    if (gameMode === "tutorial") {
      if (tutorialPhase !== "play") return;
      if (tutorialStep === 5 && attackGauge >= 20) {
        setAttackGauge(0);
        setCentralNotice({ text: "LIGHT ATTACK", type: "attack", subtext: "Attack Success!" });
        setEnemyHitAnim(true);
        setTimeout(() => setEnemyHitAnim(false), 500);
        setOpponentData(prev => ({ ...prev, battleHp: prev.battleHp - 8 }));
        setTutorialPhase("success");
      } else if (tutorialStep === 7 && attackGauge >= 100) {
        if (tutorialPhase !== "play") return;
        setAttackGauge(0);
        setShieldStacks(s => Math.min(5, s + 1));
        setShieldActivateAnim(true);
        setTimeout(() => setShieldActivateAnim(false), 800);

        setCentralNotice({ text: "SHIELD ARMOR +8%", type: "good", subtext: "ENEMY TOOK 10 DMG!" });
        setOpponentData(prev => ({ ...prev, battleHp: Math.max(0, prev.battleHp - 10) }));
        setEnemyHitAnim(true);
        setTimeout(() => setEnemyHitAnim(false), 500);

        setTimeout(() => {
          setTutorialPhase("success");
        }, 1500);
        return;
      } else if (tutorialStep === 9 && attackGauge >= 20) {
        // Practice battle manual attack
        let type = "light"; let cost = 20; let msg = "LIGHT ATTACK";
        let damage = 8;
        if (attackGauge >= 100) { type = "shield_attack"; cost = 100; msg = "SHIELD ARMOR DEPLOYED"; damage = 10; }
        else if (attackGauge >= 60) { type = "fakejam"; cost = 60; msg = "FAKE JAM"; damage = 12; }

        setAttackGauge(prev => Math.max(0, prev - cost));
        if (type === "shield_attack") {
          setShieldStacks(prev => {
            const next = Math.min(5, prev + 1);
            setCentralNotice({ text: "SHIELD ARMOR +8%", type: "good", subtext: `TOTAL REDUCTION: ${next * 8}%` });
            return next;
          });
          setShieldActivateAnim(true);
          setTimeout(() => setShieldActivateAnim(false), 800);
          setOpponentData(prev => ({ ...prev, battleHp: Math.max(0, prev.battleHp - 10) }));
          setEnemyHitAnim(true);
          setTimeout(() => setEnemyHitAnim(false), 500);
        } else {
          setCentralNotice({ text: msg, type: type === "fakejam" ? "critical" : "attack", subtext: "Attack Success!" });
          setEnemyHitAnim(true);
          setTimeout(() => setEnemyHitAnim(false), 500);
          setOpponentData(prev => ({
            ...prev,
            battleHp: Math.max(0, prev.battleHp - damage),
            fakeJamCharges: type === "fakejam" ? prev.fakeJamCharges + 2 : prev.fakeJamCharges
          }));
        }
      }
      return;
    }

    if (gameMode !== "multi" || attackGauge < 20) return;

    let type = "light";
    let cost = 20;
    let msg = "ATTACK SENT: LIGHT";

    if (attackGauge >= 100) {
      type = "shield_attack";
      cost = 100;
      msg = "SHIELD ARMOR DEPLOYED";
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

    if (type === "shield_attack") {
      setShieldStacks(prev => {
        const next = Math.min(5, prev + 1);
        setMessage({ text: msg, type: "good", id: Date.now() });
        setCentralNotice({ text: "SHIELD ARMOR +8%", type: "good", subtext: `TOTAL REDUCTION: ${next * 8}%` });
        addBattleLog("good", `Armor +8% & Dealt 10 DMG (${next} Stacks)`);
        
        if (myPlayerRef.current) {
          update(myPlayerRef.current, { shieldStacks: next }).catch(() => {});
        }
        return next;
      });

      setShieldActivateAnim(true);
      setTimeout(() => setShieldActivateAnim(false), 800);
      sendAttack("shield_attack", msg);
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
        shieldStacks,
        status: battleHp <= 0 ? "dead" : "alive"
      }).catch(() => { });
    }
  }, [score, battleHp, attackGauge, lives, shieldStacks, gameMode, screen, myUid]);

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
    if (screen !== "playing" && screen !== "tutorial") return;

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
    if ((screen === "playing" || screen === "tutorial") && timeLeft <= 0) {
      if (gameMode === "tutorial") {
        advanceTutorial();
      } else {
        endGame();
      }
    }
  }, [screen, timeLeft, gameMode]);

  useEffect(() => {
    const audio = tickAudioRef.current;
    if (!audio) return;

    if ((screen === "playing" || screen === "tutorial") && timeLeft <= 10 && timeLeft > 0) {
      audio.play().catch(() => { });
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [screen, timeLeft]);

  useEffect(() => {
    if ((screen !== "playing" && screen !== "tutorial") || !currentKey) return;

    if (roundTimeoutRef.current) {
      clearTimeout(roundTimeoutRef.current);
    }

    roundTimeoutRef.current = setTimeout(() => {
      if (gameMode === "tutorial") {
        handleTutorialAction("timeout");
      } else {
        handleTimeout();
      }
    }, actualRoundWindow);

    return () => {
      if (roundTimeoutRef.current) {
        clearTimeout(roundTimeoutRef.current);
        roundTimeoutRef.current = null;
      }
    };
  }, [screen, currentKey, actualRoundWindow, isFake, tutorialPhase, tutorialStep]);

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

  const handleTutorialAction = (action) => {
    if (tutorialPhase !== "play" && tutorialPhase !== "fake_key_active") return;

    if (action === "correct") {
      playSuccessSound();
      setMessage({ text: "PERFECT", id: Date.now() });
      setFlashType("success");

      if (tutorialStep === 1) {
        const nextTarget = tutorialTarget + 1;
        setTutorialTarget(nextTarget);
        if (nextTarget >= 3) {
          setTutorialPhase("success");
          setCurrentKey("");
        } else {
          spawnNextKey();
        }
      } else if (tutorialStep === 2) {
        spawnNextKey();
      } else if (tutorialStep === 4) {
        setAttackGauge(prev => {
          const next = Math.min(100, prev + 25);
          if (next >= 100) {
            setTutorialPhase("success");
            setCurrentKey("");
          }
          return next;
        });
        if (tutorialPhase !== "success") spawnNextKey();
      } else if (tutorialStep === 9) {
        setCombo(prev => prev + 1);
        setAttackGauge(prev => Math.min(100, prev + 8));
        spawnNextKey();
      } else {
        spawnNextKey();
      }
    } else if (action === "wrong") {
      playMissSound();
      setMessage({ text: "MISS", id: Date.now() });
      setFlashType("miss");

      if (tutorialStep === 6 && tutorialPhase === "fake_key_active") {
        setTutorialPhase("retry_wait");
        setCentralNotice({ text: "FAILED", type: "bad", subtext: "今の FAKE キーは押してはいけません" });
        setTimeout(() => {
          setTutorialPhase("fake_key_active");
          setCentralNotice({ text: "RETRY", type: "critical", subtext: "THIS KEY IS FAKE" });
          fakeJamChargesRef.current = 1;
          spawnNextKey();
        }, 2500);
        setCurrentKey("");
      } else if (tutorialStep === 9) {
        setCombo(0);
        setAttackGauge(prev => Math.max(0, prev - 8));
        spawnNextKey(currentKey);
      } else {
        spawnNextKey(currentKey);
      }
    } else if (action === "timeout") {
      if (isFake) {
        playFakeAvoidSound();
        setMessage({ text: "FAKE AVOID", id: Date.now() });
        setFlashType("fake-avoid");
        setAvoidedKey(currentKey);
        setTimeout(() => setAvoidedKey(null), 350);
        if (tutorialStep === 2) {
          const nextTarget = tutorialTarget + 1;
          setTutorialTarget(nextTarget);
          setCentralNotice({ text: "GOOD", type: "good", subtext: `FAKE AVOID ${nextTarget} / 3` });
          if (nextTarget >= 3) {
            setTimeout(() => setTutorialPhase("success"), 500);
            setCurrentKey("");
          } else {
            spawnNextKey();
          }
          return;
        } else if (tutorialStep === 6) {
          if (tutorialTarget === 0) {
            setTutorialTarget(1);
            setCentralNotice({ text: "FAKE AVOIDED", type: "good", subtext: "もう1回 FAKE キーが来ます" });
            spawnNextKey();
          } else {
            setTutorialPhase("fake_avoid_success");
            setCentralNotice({ text: "FAKE JAM EVADED", type: "good", subtext: "妨害を正しく回避しました" });
            setTimeout(() => {
              setTutorialPhase("success");
            }, 2000);
            setCurrentKey("");
          }
          return;
        } else if (tutorialStep === 9) {
          setAttackGauge(prev => Math.min(100, prev + 8));
        }
        spawnNextKey();
      } else {
        playMissSound();
        setMessage({ text: "TOO SLOW", id: Date.now() });
        setFlashType("miss");
        if (tutorialStep === 2) {
          setCentralNotice({ text: "TOO SLOW", type: "bad", subtext: "通常キーは押してください" });
        }
        if (tutorialStep === 9) setCombo(0);
        spawnNextKey(currentKey);
      }
    } else if (action === "fakehit") {
      playMissSound();
      setMessage({ text: "TRAP", id: Date.now() });
      setFlashType("trap");
      setGlitchAnim(Date.now());
      if (tutorialStep === 2) {
        setCentralNotice({ text: "TRAP", type: "bad", subtext: "FAKEキーは押さない！" });
        spawnNextKey();
      } else if (tutorialStep === 6 && tutorialPhase === "fake_key_active") {
        setTutorialPhase("retry_wait");
        setCentralNotice({ text: "FAILED", type: "bad", subtext: "今の FAKE キーは押してはいけません" });
        setTimeout(() => {
          setTutorialPhase("fake_key_active");
          setCentralNotice({ text: "RETRY", type: "critical", subtext: "THIS KEY IS FAKE" });
          fakeJamChargesRef.current = 1;
          spawnNextKey();
        }, 2500);
        setCurrentKey("");
      } else if (tutorialStep === 9) {
        setCombo(0);
        setAttackGauge(prev => Math.max(0, prev - 10));
        spawnNextKey();
      } else {
        spawnNextKey();
      }
    }
  };

  useEffect(() => {
    if (screen !== "playing" && screen !== "tutorial") return;

    const onKeyDown = (e) => {
      if (e.repeat) return;

      if (e.code === "Space" && (gameMode === "multi" || gameMode === "tutorial") && (screen === "playing" || screen === "tutorial")) {
        e.preventDefault();
        manualAttackTrigger();
        return;
      }

      const pressed = e.key.toUpperCase();
      if (pressed.length !== 1) return;
      if (!KEYS.includes(pressed)) return;

      if (pressed === currentKey) {
        if (isFake) {
          if (gameMode === "tutorial") handleTutorialAction("fakehit");
          else handleFakeHit();
        } else {
          if (gameMode === "tutorial") handleTutorialAction("correct");
          else handleCorrect();
        }
      } else {
        if (gameMode === "tutorial") handleTutorialAction("wrong");
        else handleWrong();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen, currentKey, isFake, combo, reactionStart, tutorialPhase, tutorialStep, tutorialTarget]);

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
      {shieldActivateAnim && <div className="shield-activate-popup" />}
      
      <div className={`shell ${(screen === "playing" || screen === "tutorial" || screen === "result") ? "compact-mode" : ""}`}>
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

                <div className="title-actions" style={{ display: "flex", flexWrap: "wrap", gap: "16px", justifyContent: "center", margin: "40px auto 0", maxWidth: "600px" }}>
                  <button className="start-btn" onClick={() => { setGameMode("single"); setScreen("single_prep"); }} style={{ flex: "1 1 calc(50% - 8px)", padding: "18px 24px" }}>
                    Single Play
                  </button>
                  <button className="start-btn multi-btn" onClick={() => { setGameMode("multi"); setScreen("room_input"); }} style={{ flex: "1 1 calc(50% - 8px)", background: "#9333ea", borderColor: "#a855f7", padding: "18px 24px" }}>
                    Online Battle
                  </button>
                  <button className="start-btn tutorial-btn" onClick={startTutorial} style={{ flex: "1 1 100%", background: "#2563eb", borderColor: "#3b82f6", padding: "18px 24px" }}>
                    Tutorial
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

          {(screen === "playing" || screen === "result" || screen === "tutorial") && (
            <>
              {gameMode === "tutorial" && (
                <section className="tutorial-hud compact-hud" style={{ marginBottom: 8, background: 'rgba(37, 99, 235, 0.1)', border: '1px solid #3b82f6', borderRadius: 12, padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div className="tutorial-step-title" style={{ fontSize: 16, fontWeight: 'bold', color: '#60a5fa', marginBottom: 4, letterSpacing: '0.05em' }}>{TUTORIAL_STEPS[tutorialStep].title}</div>
                    <div className="tutorial-desc-box" style={{ fontSize: 13, lineHeight: 1.4, color: '#d1d5db', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                      {TUTORIAL_STEPS[tutorialStep].lines.map((l, i) => <span key={i}>{l}</span>)}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {tutorialPhase === "intro" && (
                      <button className="start-btn tutorial-next-btn" onClick={tutorialStep === 0 || tutorialStep === 3 || tutorialStep === 8 ? advanceTutorial : startTutorialPhase} style={{ padding: '8px 24px', fontSize: 14 }}>
                        {tutorialStep === 0 || tutorialStep === 3 || tutorialStep === 8 ? "NEXT STEP" : "START"}
                      </button>
                    )}
                    {tutorialPhase === "success" && (
                      <div className="tutorial-success-box" style={{ animation: 'txtPopSmall 0.3s ease', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div className="success-text" style={{ color: '#4ade80', fontSize: 18, fontWeight: 'bold' }}>CLEAR!</div>
                        <button className="start-btn tutorial-next-btn" onClick={advanceTutorial} style={{ padding: '8px 24px', fontSize: 14, background: '#16a34a', borderColor: '#22c55e' }}>NEXT STEP</button>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {(gameMode === "multi" || gameMode === "tutorial") ? (
                <section className="vs-header">
                  {(() => {
                    const eHp = opponentData?.battleHp ?? 60;
                    const eGauge = opponentData?.attackGauge ?? 0;
                    let leadStatus = "EVEN";
                    let leadClass = "even";
                    if (battleHp > eHp) { leadStatus = "LEADING"; leadClass = "leading"; }
                    else if (battleHp < eHp) { leadStatus = "LOSING"; leadClass = "losing"; }

                    const getNextAttackInfo = (gauge) => {
                      if (gauge >= 100) return { label: "SPACE: SHIELD ARMOR", color: "#6ee7b7" };
                      if (gauge >= 60) return { label: "SPACE: FAKE JAM", color: "#d8b4fe" };
                      if (gauge >= 20) return { label: "SPACE: LIGHT ATTACK", color: "#93c5fd" };
                      return { label: "NEXT: LIGHT ATTACK", color: "#9ca3af" };
                    };
                    const getEnemyAttackInfo = (gauge) => {
                      if (gauge >= 100) return { label: "READY: SHIELD ARMOR", color: "#6ee7b7" };
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
                          <div className={`vs-hp-bar ${gameMode === "tutorial" && tutorialStep === 3 ? "tutorial-pulse" : ""}`} style={{ position: "relative" }}>
                            {shieldStacks > 0 && <div className="armor-badge" style={{ position: "absolute", zIndex: 10, left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontWeight: "bold", background: "rgba(0,0,0,0.6)", padding: "2px 6px", borderRadius: 4, border: "1px solid #6ee7b7", color: "#6ee7b7" }}>ARMOR {shieldStacks * 8}%</div>}
                            {fakeJamChargesRef.current > 0 && <div className="jam-overlay player-jam" />}
                            <div className="vs-hp-fill" style={{ width: `${Math.max(0, Math.min(100, (battleHp / 60) * 100))}%`, background: battleHp <= 12 ? "#ef4444" : "#22c55e" }} />
                          </div>
                          <div className="vs-hp-val">{Math.max(0, battleHp)}</div>
                          <div className={`vs-gauge-wrap ${gameMode === "tutorial" && tutorialStep === 4 ? "tutorial-pulse" : ""}`}>
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
                          <div className="vs-hp-bar" style={{ position: "relative" }}>
                            {opponentData?.shieldStacks > 0 && <div className="armor-badge" style={{ position: "absolute", zIndex: 10, right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontWeight: "bold", background: "rgba(0,0,0,0.6)", padding: "2px 6px", borderRadius: 4, border: "1px solid #6ee7b7", color: "#6ee7b7" }}>ARMOR {opponentData.shieldStacks * 8}%</div>}
                            {opponentData?.fakeJamCharges > 0 && <div className="jam-overlay enemy-jam" />}
                            <div className="vs-hp-fill enemy" style={{ width: `${Math.max(0, Math.min(100, (eHp / 60) * 100))}%`, background: eHp <= 12 ? "#ef4444" : "#22c55e" }} />
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
                  {shieldBreakAnim && <div className="shield-field shield-break" />}
                  {shieldActivateAnim && <div className="shield-activate-popup" />}
                  {fakeJamChargesRef.current > 0 && <div className="jam-aura" />}
                  {showSkull && (
                    <div className="skull-popup">☠</div>
                  )}
                  <div
                    className={`arena-inner ${(isDanger && screen === "playing") || (tutorialPhase === "play" && tutorialStep === 9 && isDanger) ? "danger" : ""} ${isZone ? "zone" : ""}`}
                  />

                  <div className="target-wrap">
                    {centralNotice && (screen === "playing" || screen === "tutorial") && (
                      <div key={centralNotice.id} className={`central-notice ${centralNotice.type}`}>
                        <div className="central-notice-text">{centralNotice.text}</div>
                        {centralNotice.subtext && <div className="central-notice-sub">{centralNotice.subtext}</div>}
                      </div>
                    )}
                    <div className="target-label">Target Key</div>

                    {comboMsg && (screen === "playing" || screen === "tutorial") && (
                      <div className="combo-msg-wrap">
                        <div key={comboMsg.id} className={`combo-text ${comboMsg.type}`}>
                          {comboMsg.text}
                        </div>
                      </div>
                    )}

                    {(screen === "playing" || screen === "tutorial") ? (
                      <div className="key-box-wrapper">
                        <div
                          key={spawnId}
                          className={`key-box ${isFake ? "fake" : ""} ${shouldBump ? "bump-anim" : ""} ${gameMode === "tutorial" && (tutorialStep === 2 || tutorialStep === 6) && isFake ? "tutorial-pulse" : ""}`}
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
                        {(gameMode === "multi" || gameMode === "tutorial") ? (
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
                      {(screen === "playing" || screen === "tutorial") ? message.text : "Final Rank"}
                    </div>

                    {(screen === "playing" || (screen === "tutorial" && tutorialStep === 9)) && (
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

                  {(gameMode === "multi" || gameMode === "tutorial") && (screen === "playing" || screen === "tutorial") && (
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
                  {(gameMode === "multi" || gameMode === "tutorial") ? (
                    <div className="side-card tactical-loadout">
                      <div className="side-title">TACTICAL LOADOUT</div>

                      <div className={`loadout-item ${attackGauge >= 60 ? "available" : attackGauge >= 20 ? "ready light-ready" : "locked"} ${gameMode === "tutorial" && tutorialStep === 5 && attackGauge >= 20 ? "tutorial-pulse" : ""}`}>
                        <div className="loadout-header">
                          <span className="loadout-cost">20G</span>
                          <span className="loadout-name">LIGHT ATTACK</span>
                          <span className="loadout-tag light">CHIP</span>
                        </div>
                        <div className="loadout-desc">確実な小ダメージ（8HP）を与える基本攻撃。<br />消費が軽く、連発での牽制や削りに最適。</div>
                      </div>

                      <div className={`loadout-item ${attackGauge >= 100 ? "available" : attackGauge >= 60 ? "ready jam-ready" : "locked"}`}>
                        <div className="loadout-header">
                          <span className="loadout-cost">60G</span>
                          <span className="loadout-name">FAKE JAM</span>
                          <span className="loadout-tag jam">DISRUPT</span>
                        </div>
                        <div className="loadout-desc">ダメージ（12HP）に加え、相手の次の2連続キー<br />を強制的にフェイク化してリズムを崩す。</div>
                      </div>

                      <div className={`loadout-item ${attackGauge >= 100 ? "ready shield-ready" : "locked"} ${gameMode === "tutorial" && tutorialStep === 7 && attackGauge >= 100 ? "tutorial-pulse" : ""}`}>
                        <div className="loadout-header">
                          <span className="loadout-cost">MAX</span>
                          <span className="loadout-name">SHIELD ARMOR</span>
                          <span className="loadout-tag shield">ARMOR</span>
                        </div>
                        <div className="loadout-desc">発動時に10ダメージを与えつつ、自身の受ける<br />ダメージを永続で8%軽減する。（最大40%）</div>
                      </div>

                      <div className="loadout-status">
                        {attackGauge >= 100 ? "SHIELD ARMOR DEPLOYMENT READY" :
                          attackGauge >= 60 ? "FAKE JAM READY" :
                            attackGauge >= 20 ? "LIGHT ATTACK READY" :
                              "BUILD GAUGE TO UNLOCK ATTACK"}
                      </div>
                    </div>
                  ) : (
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
                  )}

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

                  {(gameMode === "multi" || gameMode === "tutorial") && opponentData && (
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
          {screen === "tutorial_complete" && (
            <div className="center-screen">
              <div className="panel tutorial-panel" style={{ border: '1px solid #3b82f6', background: 'rgba(37, 99, 235, 0.05)', boxShadow: '0 0 50px rgba(59, 130, 246, 0.15)' }}>
                <div className="warning" style={{ color: '#93c5fd' }}>Mission Accomplished</div>
                <h2 className="hero2" style={{ fontSize: "48px", color: '#60a5fa' }}>TUTORIAL COMPLETE</h2>
                <div className="desc" style={{ fontSize: '18px', color: '#e5e7eb', marginBottom: '40px' }}>
                  オンラインバトルの基本を習得しました！<br />
                  準備ができたら Online Battle に挑戦しましょう。
                </div>

                <div className="title-actions" style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", maxWidth: "400px", margin: "0 auto" }}>
                  <button className="start-btn multi-btn" onClick={() => { setGameMode("multi"); setScreen("room_input"); }} style={{ width: "100%", background: "#9333ea", borderColor: "#a855f7" }}>
                    Play Online Battle
                  </button>
                  <button className="title-btn" style={{ width: "100%", padding: "16px", fontSize: "16px", color: "#60a5fa", borderColor: "rgba(96, 165, 250, 0.4)" }} onClick={startTutorial}>
                    Replay Tutorial
                  </button>
                  <button className="title-btn" style={{ width: "100%", padding: "16px", fontSize: "16px" }} onClick={goToTitle}>
                    Back to Title
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
