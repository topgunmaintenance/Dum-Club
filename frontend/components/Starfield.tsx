"use client";

import { useEffect, useRef } from "react";

/**
 * Two-layer cinematic background: twinkling star field + shooting meteors.
 * Keeps the same export name for drop-in compatibility.
 */
export function Starfield({ count = 120 }: { count?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w: number, h: number, raf: number;
    let lastFrame = 0;
    const FRAME_INTERVAL = 33; // ~30fps instead of 60fps

    /* ── Layer 1: static twinkling star field ── */
    type Star = {
      x: number; y: number; size: number;
      baseAlpha: number; speed: number; phase: number;
      r: number; g: number; b: number; glow: boolean;
    };
    let stars: Star[] = [];

    const buildStars = () => {
      stars = Array.from({ length: count }, () => {
        const roll = Math.random();
        const [r, g, b] =
          roll < 0.6
            ? [180 + Math.random() * 75, 190 + Math.random() * 65, 220 + Math.random() * 35]
            : roll < 0.85
            ? [0, 180 + Math.random() * 75, 130 + Math.random() * 73]
            : [100 + Math.random() * 60, 70 + Math.random() * 50, 200 + Math.random() * 55];
        const size =
          Math.random() < 0.7 ? Math.random() * 0.9 + 0.3
          : Math.random() < 0.85 ? Math.random() * 1.3 + 0.8
          : Math.random() * 1.8 + 1.2;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          size,
          baseAlpha: 0.25 + Math.random() * 0.55,
          speed: 0.006 + Math.random() * 0.02,
          phase: Math.random() * Math.PI * 2,
          r, g, b,
          glow: size > 1.5,
        };
      });
    };

    /* ── Layer 2: shooting meteors ── */
    type Meteor = {
      x: number; y: number;
      vx: number; vy: number;
      trailLen: number; headSize: number;
      glowColor: string; headColor: string;
      trail: [number, number, number];
      life: number; spawnTs: number;
    };
    let meteors: Meteor[] = [];
    let nextSpawn = 0;

    const palettes = [
      { head: "#00FFA3", glow: "rgba(0,255,163,", trail: [0, 255, 163] },
      { head: "#7B61FF", glow: "rgba(123,97,255,", trail: [123, 97, 255] },
      { head: "#FFFFFF", glow: "rgba(220,230,255,", trail: [220, 230, 255] },
    ];

    const spawnMeteor = (ts: number) => {
      const roll = Math.random();
      const pal = roll < 0.55 ? palettes[0] : roll < 0.82 ? palettes[1] : palettes[2];
      const angleDeg = 20 + Math.random() * 30;
      const angle = (angleDeg * Math.PI) / 180;
      const speed = 5 + Math.random() * 8;
      const trailLen = 70 + Math.random() * 100;
      const headSize = 1.2 + Math.random() * 1.8;

      let sx: number, sy: number;
      if (Math.random() < 0.6) {
        sx = -trailLen;
        sy = Math.random() * h * 0.65;
      } else {
        sx = Math.random() * w * 0.55;
        sy = -trailLen;
      }

      meteors.push({
        x: sx, y: sy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        trailLen, headSize,
        glowColor: pal.glow,
        headColor: pal.head,
        trail: pal.trail as [number, number, number],
        life: 1,
        spawnTs: ts,
      });

      const isBurst = Math.random() < 0.15;
      nextSpawn = ts + (isBurst ? 250 + Math.random() * 500 : 1800 + Math.random() * 3500);
    };

    const resize = () => {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
      buildStars();
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = (ts: number) => {
      // Throttle to ~30fps
      if (ts - lastFrame < FRAME_INTERVAL) {
        raf = requestAnimationFrame(draw);
        return;
      }
      lastFrame = ts;

      ctx.clearRect(0, 0, w, h);

      /* ── draw twinkling stars (no shadow — GPU expensive) ── */
      for (const s of stars) {
        s.phase += s.speed;
        const alpha = s.baseAlpha * (0.3 + 0.7 * Math.sin(s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.r | 0},${s.g | 0},${s.b | 0},${alpha.toFixed(3)})`;
        ctx.fill();
      }

      /* ── spawn new meteor ── */
      if (meteors.length < 3 && ts > nextSpawn) {
        spawnMeteor(ts);
      }

      /* ── draw & update meteors ── */
      meteors = meteors.filter(
        (m) => m.x < w + m.trailLen + 50 && m.y < h + m.trailLen + 50
      );

      for (const m of meteors) {
        m.x += m.vx;
        m.y += m.vy;

        const angle = Math.atan2(m.vy, m.vx);
        const tailX = m.x - Math.cos(angle) * m.trailLen;
        const tailY = m.y - Math.sin(angle) * m.trailLen;

        const age = ts - m.spawnTs;
        const fadeIn = Math.min(1, age / 300);

        /* gradient trail */
        const grad = ctx.createLinearGradient(tailX, tailY, m.x, m.y);
        grad.addColorStop(0, `${m.glowColor}0)`);
        grad.addColorStop(0.6, `${m.glowColor}${(0.1 * fadeIn).toFixed(2)})`);
        grad.addColorStop(0.85, `${m.glowColor}${(0.35 * fadeIn).toFixed(2)})`);
        grad.addColorStop(1, `${m.glowColor}${(0.8 * fadeIn).toFixed(2)})`);

        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(m.x, m.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = m.headSize * 0.55;
        ctx.lineCap = "round";
        ctx.stroke();

        /* glowing head (single pass, reduced shadow) */
        ctx.shadowBlur = 8;
        ctx.shadowColor = m.headColor;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.headSize * fadeIn, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${(0.8 * fadeIn).toFixed(2)})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [count]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 h-full w-full"
      style={{ opacity: 0.9, zIndex: 0 }}
    />
  );
}
