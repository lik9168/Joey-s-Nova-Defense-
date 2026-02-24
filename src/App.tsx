/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Target, Trophy, RotateCcw, Play, Info, AlertTriangle } from 'lucide-react';
import { getGameTips } from './services/geminiService';

// --- Constants ---
const TARGET_SCORE = 1000;
const INITIAL_AMMO = { left: 20, center: 40, right: 20 };
const EXPLOSION_RADIUS = 40;
const EXPLOSION_DURATION = 60; // frames
const MISSILE_SPEED = 4;
const ENEMY_SPEED_MIN = 0.5;
const ENEMY_SPEED_MAX = 1.5;

type Point = { x: number; y: number };
type Particle = Point & { vx: number; vy: number; life: number; color: string };
type Missile = {
  id: number;
  start: Point;
  current: Point;
  target: Point;
  speed: number;
  color: string;
  isEnemy: boolean;
};
type Explosion = Point & { radius: number; maxRadius: number; timer: number; id: number };
type Building = Point & { width: number; height: number; isDestroyed: boolean; type: 'city' | 'battery'; id: number; batterySide?: 'left' | 'center' | 'right' };

type Difficulty = 'easy' | 'medium' | 'hard';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'won' | 'lost'>('menu');
  const [score, setScore] = useState(0);
  const [ammo, setAmmo] = useState(INITIAL_AMMO);
  const [language, setLanguage] = useState<'en' | 'zh'>('zh');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [showHelp, setShowHelp] = useState(false);
  const [aiTip, setAiTip] = useState<string | null>(null);

  // Game Objects Refs
  const missilesRef = useRef<Missile[]>([]);
  const explosionsRef = useRef<Explosion[]>([]);
  const buildingsRef = useRef<Building[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const frameIdRef = useRef<number>(0);
  const lastEnemySpawnRef = useRef<number>(0);
  const nextIdRef = useRef(0);

  const t = {
    en: {
      title: "Joey's Nova Defense",
      start: "Start Game",
      win: "Victory!",
      lose: "Game Over",
      retry: "Play Again",
      score: "Score",
      target: "Target",
      ammo: "Ammo",
      left: "L",
      center: "C",
      right: "R",
      tip: "AI Commander Tip:",
      instructions: "Click anywhere to intercept incoming rockets. Protect your cities and batteries!",
      helpTitle: "How to Play",
      helpText: [
        "1. Enemy rockets fall from the top to destroy your cities.",
        "2. Click/Touch anywhere to fire an interceptor missile.",
        "3. Missiles explode at the target location, destroying nearby rockets.",
        "4. You have limited ammo in 3 batteries. Use them wisely!",
        "5. Reach 1000 points to win. Game ends if all batteries are destroyed."
      ],
      difficulty: "Difficulty",
      easy: "Easy",
      medium: "Medium",
      hard: "Hard",
      help: "Help",
      close: "Close"
    },
    zh: {
      title: "Joey新星防御",
      start: "开始游戏",
      win: "胜利！",
      lose: "游戏结束",
      retry: "再玩一次",
      score: "得分",
      target: "目标",
      ammo: "弹药",
      left: "左",
      center: "中",
      right: "右",
      tip: "AI 指挥官建议：",
      instructions: "点击屏幕任何位置发射拦截导弹。保护你的城市和炮台！",
      helpTitle: "玩法介绍",
      helpText: [
        "1. 敌方火箭从顶部落下，目标是摧毁你的城市。",
        "2. 点击或触摸屏幕任意位置发射拦截导弹。",
        "3. 导弹会在点击处爆炸，产生的范围伤害可摧毁附近火箭。",
        "4. 你有三座炮台，弹药有限，请谨慎使用！",
        "5. 达到 1000 分即可获胜。如果所有炮台被毁，游戏结束。"
      ],
      difficulty: "难度",
      easy: "简单",
      medium: "普通",
      hard: "困难",
      help: "帮助",
      close: "关闭"
    }
  }[language];

  // --- Difficulty Modifiers ---
  const getDifficultyModifiers = () => {
    switch (difficulty) {
      case 'easy': return { speedMult: 0.7, spawnMult: 1.5 };
      case 'hard': return { speedMult: 1.3, spawnMult: 0.7 };
      default: return { speedMult: 1.0, spawnMult: 1.0 };
    }
  };

  // --- Initialization ---
  const initGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const groundY = height - 40;
    const buildings: Building[] = [];

    // Batteries
    buildings.push({ id: 0, x: 50, y: groundY - 30, width: 60, height: 30, isDestroyed: false, type: 'battery', batterySide: 'left' });
    buildings.push({ id: 1, x: width / 2 - 40, y: groundY - 40, width: 80, height: 40, isDestroyed: false, type: 'battery', batterySide: 'center' });
    buildings.push({ id: 2, x: width - 110, y: groundY - 30, width: 60, height: 30, isDestroyed: false, type: 'battery', batterySide: 'right' });

    // Cities
    const cityCount = 6;
    const spacing = (width - 300) / (cityCount + 1);
    for (let i = 0; i < cityCount; i++) {
      const x = 150 + (i + 1) * spacing - 20;
      buildings.push({ id: 3 + i, x, y: groundY - 20, width: 40, height: 20, isDestroyed: false, type: 'city' });
    }

    buildingsRef.current = buildings;
    missilesRef.current = [];
    explosionsRef.current = [];
    particlesRef.current = [];
    setScore(0);
    setAmmo(INITIAL_AMMO);
    setAiTip(null);
    setShowHelp(false);
  }, []);

  const spawnEnemy = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const targetBuildings = buildingsRef.current.filter(b => !b.isDestroyed);
    if (targetBuildings.length === 0) return;

    const target = targetBuildings[Math.floor(Math.random() * targetBuildings.length)];
    const startX = Math.random() * canvas.width;
    
    const { speedMult } = getDifficultyModifiers();

    missilesRef.current.push({
      id: nextIdRef.current++,
      start: { x: startX, y: 0 },
      current: { x: startX, y: 0 },
      target: { x: target.x + target.width / 2, y: target.y + target.height / 2 },
      speed: (ENEMY_SPEED_MIN + Math.random() * (ENEMY_SPEED_MAX - ENEMY_SPEED_MIN)) * speedMult,
      color: '#ff4444',
      isEnemy: true
    });
  }, [difficulty]);

  const createExplosion = (x: number, y: number) => {
    explosionsRef.current.push({
      id: nextIdRef.current++,
      x,
      y,
      radius: 0,
      maxRadius: EXPLOSION_RADIUS,
      timer: EXPLOSION_DURATION
    });

    // Add some particles
    for (let i = 0; i < 15; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
        life: 1,
        color: `hsl(${Math.random() * 60 + 10}, 100%, 50%)`
      });
    }
  };

  const fireMissile = (targetX: number, targetY: number) => {
    if (gameState !== 'playing' || showHelp) return;

    const batteries = buildingsRef.current.filter(b => b.type === 'battery' && !b.isDestroyed);
    if (batteries.length === 0) return;

    // Find closest battery with ammo
    let bestBattery: Building | null = null;
    let minDist = Infinity;

    batteries.forEach(b => {
      const side = b.batterySide as keyof typeof INITIAL_AMMO;
      if (ammo[side] > 0) {
        const dist = Math.abs(b.x + b.width / 2 - targetX);
        if (dist < minDist) {
          minDist = dist;
          bestBattery = b;
        }
      }
    });

    if (bestBattery) {
      const side = (bestBattery as Building).batterySide as keyof typeof INITIAL_AMMO;
      setAmmo(prev => ({ ...prev, [side]: prev[side] - 1 }));

      missilesRef.current.push({
        id: nextIdRef.current++,
        start: { x: (bestBattery as Building).x + (bestBattery as Building).width / 2, y: (bestBattery as Building).y },
        current: { x: (bestBattery as Building).x + (bestBattery as Building).width / 2, y: (bestBattery as Building).y },
        target: { x: targetX, y: targetY },
        speed: MISSILE_SPEED,
        color: '#44ccff',
        isEnemy: false
      });
    }
  };

  // --- Game Loop ---
  const update = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (showHelp) {
      frameIdRef.current = requestAnimationFrame(update);
      return;
    }

    // Spawn enemies
    const { spawnMult } = getDifficultyModifiers();
    const baseSpawnRate = Math.max(500, 2000 - (score / 100) * 200);
    const spawnRate = baseSpawnRate * spawnMult;

    if (time - lastEnemySpawnRef.current > spawnRate) {
      spawnEnemy();
      lastEnemySpawnRef.current = time;
    }

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Ground
    ctx.fillStyle = '#2d2d44';
    ctx.fillRect(0, canvas.height - 40, canvas.width, 40);

    // Update & Draw Missiles
    missilesRef.current = missilesRef.current.filter(m => {
      const dx = m.target.x - m.current.x;
      const dy = m.target.y - m.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < m.speed) {
        if (m.isEnemy) {
          createExplosion(m.target.x, m.target.y);
          buildingsRef.current.forEach(b => {
            if (!b.isDestroyed) {
              const bx = b.x + b.width / 2;
              const by = b.y + b.height / 2;
              const d = Math.sqrt((bx - m.target.x) ** 2 + (by - m.target.y) ** 2);
              if (d < 30) b.isDestroyed = true;
            }
          });
        } else {
          createExplosion(m.target.x, m.target.y);
        }
        return false;
      }

      const vx = (dx / dist) * m.speed;
      const vy = (dy / dist) * m.speed;
      m.current.x += vx;
      m.current.y += vy;

      ctx.beginPath();
      ctx.moveTo(m.start.x, m.start.y);
      ctx.lineTo(m.current.x, m.current.y);
      ctx.strokeStyle = m.color + '44';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = m.color;
      ctx.fillRect(m.current.x - 1, m.current.y - 1, 3, 3);

      return true;
    });

    // Update & Draw Explosions
    explosionsRef.current = explosionsRef.current.filter(e => {
      e.timer--;
      const progress = 1 - e.timer / EXPLOSION_DURATION;
      e.radius = Math.sin(progress * Math.PI) * e.maxRadius;

      missilesRef.current = missilesRef.current.filter(m => {
        if (m.isEnemy) {
          const d = Math.sqrt((m.current.x - e.x) ** 2 + (m.current.y - e.y) ** 2);
          if (d < e.radius) {
            setScore(prev => prev + 20);
            createExplosion(m.current.x, m.current.y);
            return false;
          }
        }
        return true;
      });

      const gradient = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.radius);
      gradient.addColorStop(0, '#fff');
      gradient.addColorStop(0.4, '#ffaa00');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();

      return e.timer > 0;
    });

    // Update & Draw Particles
    particlesRef.current = particlesRef.current.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.fillRect(p.x, p.y, 2, 2);
      ctx.globalAlpha = 1.0;
      return p.life > 0;
    });

    // Draw Buildings
    buildingsRef.current.forEach(b => {
      if (b.isDestroyed) {
        ctx.fillStyle = '#333';
        ctx.fillRect(b.x, b.y + b.height - 5, b.width, 5);
      } else {
        ctx.fillStyle = b.type === 'battery' ? '#4a4a6a' : '#6a6a8a';
        ctx.fillRect(b.x, b.y, b.width, b.height);
        
        if (b.type === 'battery') {
          ctx.fillStyle = '#88f';
          ctx.fillRect(b.x + b.width / 2 - 5, b.y - 10, 10, 10);
          const side = b.batterySide as keyof typeof INITIAL_AMMO;
          ctx.fillStyle = '#fff';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(ammo[side].toString(), b.x + b.width / 2, b.y + b.height / 2 + 4);
        }
      }
    });

    // Check Win/Loss
    if (score >= TARGET_SCORE) {
      setGameState('won');
    } else {
      const activeBatteries = buildingsRef.current.filter(b => b.type === 'battery' && !b.isDestroyed);
      if (activeBatteries.length === 0) {
        setGameState('lost');
      }
    }

    if (gameState === 'playing') {
      frameIdRef.current = requestAnimationFrame(update);
    }
  }, [gameState, score, ammo, spawnEnemy, showHelp, difficulty]);

  useEffect(() => {
    if (gameState === 'playing') {
      initGame();
      lastEnemySpawnRef.current = performance.now();
      frameIdRef.current = requestAnimationFrame(update);
    } else {
      cancelAnimationFrame(frameIdRef.current);
      if (gameState === 'won' || gameState === 'lost') {
        getGameTips(score, language).then(setAiTip);
      }
    }
    return () => cancelAnimationFrame(frameIdRef.current);
  }, [gameState, initGame, update, language, score]);

  // --- Handlers ---
  const handleCanvasClick = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameState !== 'playing' || showHelp) return;
    
    let x, y;
    if ('touches' in e) {
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    } else {
      x = (e as React.MouseEvent).clientX;
      y = (e as React.MouseEvent).clientY;
    }
    
    fireMissile(x, y);
  };

  return (
    <div className="game-container" ref={containerRef}>
      <div className="scanlines" />
      
      <canvas 
        ref={canvasRef} 
        onMouseDown={handleCanvasClick}
        onTouchStart={handleCanvasClick}
      />

      {/* HUD */}
      {gameState === 'playing' && (
        <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start pointer-events-none">
          <div className="flex flex-col gap-2">
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3 rounded-xl">
              <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">{t.score}</div>
              <div className="text-2xl font-mono font-bold text-emerald-400">{score.toString().padStart(5, '0')}</div>
            </div>
            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3 rounded-xl">
              <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">{t.target}</div>
              <div className="text-xl font-mono font-bold text-white/80">{TARGET_SCORE}</div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 pointer-events-auto">
            <div className="flex gap-2">
              <button 
                onClick={() => setShowHelp(true)}
                className="bg-indigo-600/80 hover:bg-indigo-500 p-2 rounded-lg text-xs transition-colors flex items-center gap-1"
              >
                <Info className="w-4 h-4" /> {t.help}
              </button>
              <button 
                onClick={() => setLanguage(l => l === 'en' ? 'zh' : 'en')}
                className="bg-white/10 hover:bg-white/20 p-2 rounded-lg text-xs transition-colors"
              >
                {language === 'en' ? '中文' : 'EN'}
              </button>
            </div>

            <div className="bg-black/40 backdrop-blur-md border border-white/10 p-2 rounded-xl flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-white/50">{t.difficulty}:</span>
              <select 
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                className="bg-transparent text-xs font-bold text-white outline-none cursor-pointer"
              >
                <option value="easy" className="bg-zinc-900">{t.easy}</option>
                <option value="medium" className="bg-zinc-900">{t.medium}</option>
                <option value="hard" className="bg-zinc-900">{t.hard}</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      <AnimatePresence>
        {showHelp && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-[60] p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="max-w-md w-full bg-zinc-900 border border-white/10 rounded-3xl p-8 shadow-2xl"
            >
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Info className="w-6 h-6 text-indigo-400" /> {t.helpTitle}
              </h2>
              <ul className="space-y-4 text-left mb-8">
                {t.helpText.map((item, idx) => (
                  <li key={idx} className="text-zinc-300 text-sm leading-relaxed">{item}</li>
                ))}
              </ul>
              <button 
                onClick={() => setShowHelp(false)}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition-all active:scale-95"
              >
                {t.close}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Menus */}
      <AnimatePresence>
        {gameState !== 'playing' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-50 p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="max-w-md w-full bg-zinc-900 border border-white/10 rounded-3xl p-8 text-center shadow-2xl"
            >
              {gameState === 'menu' && (
                <>
                  <div className="w-20 h-20 bg-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Shield className="w-10 h-10 text-indigo-400" />
                  </div>
                  <h1 className="text-4xl font-bold mb-4 tracking-tight">{t.title}</h1>
                  
                  <div className="text-left bg-white/5 rounded-xl p-4 mb-6 border border-white/5">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-2">{t.helpTitle}</h3>
                    <ul className="space-y-2">
                      {t.helpText.slice(0, 3).map((item, idx) => (
                        <li key={idx} className="text-xs text-zinc-400">{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex items-center justify-between mb-8 px-2">
                    <span className="text-sm text-zinc-400">{t.difficulty}</span>
                    <div className="flex gap-2">
                      {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                        <button
                          key={d}
                          onClick={() => setDifficulty(d)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            difficulty === d 
                            ? 'bg-indigo-600 text-white' 
                            : 'bg-white/5 text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          {t[d]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button 
                    onClick={() => setGameState('playing')}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    {t.start}
                  </button>
                </>
              )}

              {gameState === 'won' && (
                <>
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Trophy className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h1 className="text-4xl font-bold mb-2 text-emerald-400">{t.win}</h1>
                  <div className="text-zinc-400 mb-6">{t.score}: <span className="text-white font-mono">{score}</span></div>
                  
                  {aiTip && (
                    <div className="bg-white/5 rounded-xl p-4 mb-8 text-left border border-white/5">
                      <div className="text-[10px] uppercase tracking-widest text-indigo-400 mb-1 flex items-center gap-1">
                        <Info className="w-3 h-3" /> {t.tip}
                      </div>
                      <p className="text-sm italic text-zinc-300">"{aiTip}"</p>
                    </div>
                  )}

                  <button 
                    onClick={() => setGameState('playing')}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <RotateCcw className="w-5 h-5" />
                    {t.retry}
                  </button>
                </>
              )}

              {gameState === 'lost' && (
                <>
                  <div className="w-20 h-20 bg-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <AlertTriangle className="w-10 h-10 text-red-400" />
                  </div>
                  <h1 className="text-4xl font-bold mb-2 text-red-400">{t.lose}</h1>
                  <div className="text-zinc-400 mb-6">{t.score}: <span className="text-white font-mono">{score}</span></div>

                  {aiTip && (
                    <div className="bg-white/5 rounded-xl p-4 mb-8 text-left border border-white/5">
                      <div className="text-[10px] uppercase tracking-widest text-indigo-400 mb-1 flex items-center gap-1">
                        <Info className="w-3 h-3" /> {t.tip}
                      </div>
                      <p className="text-sm italic text-zinc-300">"{aiTip}"</p>
                    </div>
                  )}

                  <button 
                    onClick={() => setGameState('playing')}
                    className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <RotateCcw className="w-5 h-5" />
                    {t.retry}
                  </button>
                </>
              )}

              <div className="mt-6 flex justify-center gap-4">
                <button 
                  onClick={() => setLanguage(l => l === 'en' ? 'zh' : 'en')}
                  className="text-zinc-500 hover:text-white text-sm transition-colors"
                >
                  {language === 'en' ? '切换到中文' : 'Switch to English'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Controls Overlay */}
      {gameState === 'playing' && (
        <div className="absolute bottom-12 left-0 w-full flex justify-around pointer-events-none opacity-20">
          <div className="w-12 h-12 border-2 border-dashed border-white rounded-full flex items-center justify-center">
            <Target className="w-6 h-6" />
          </div>
          <div className="w-12 h-12 border-2 border-dashed border-white rounded-full flex items-center justify-center">
            <Target className="w-6 h-6" />
          </div>
          <div className="w-12 h-12 border-2 border-dashed border-white rounded-full flex items-center justify-center">
            <Target className="w-6 h-6" />
          </div>
        </div>
      )}
    </div>
  );
}
