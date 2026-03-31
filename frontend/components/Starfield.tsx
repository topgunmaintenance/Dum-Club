"use client";

import { useEffect, useRef } from "react";

/**
 * Subtle ambient starfield background.
 * Renders twinkling dots on a canvas. Designed to sit behind page content
 * at low opacity. Negligible performance cost (~70-100 arc draws/frame).
 */
export function Starfield({ count = 80 }: { count?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w: number, h: number, raf: number;

    type Star = {
      x: number;
      y: number;
      size: number;
      baseAlpha: number;
      speed: number;
      phase: number;
      r: number;
      g: number;
      b: number;
    };

    let stars: Star[] = [];

    const build = () => {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
      stars = Array.from({ length: count }, () => {
        const roll = Math.random();
        // 65% cool white, 25% mint tint, 10% violet tint
        const [r, g, b] =
          roll < 0.65
            ? [180 + Math.random() * 70, 190 + Math.random() * 60, 220 + Math.random() * 35]
            : roll < 0.9
            ? [0, 180 + Math.random() * 70, 130 + Math.random() * 70]
            : [100 + Math.random() * 55, 70 + Math.random() * 45, 200 + Math.random() * 55];
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          size: Math.random() < 0.85 ? Math.random() * 0.7 + 0.2 : Math.random() * 1.1 + 0.6,
          baseAlpha: 0.15 + Math.random() * 0.35,
          speed: 0.004 + Math.random() * 0.012,
          phase: Math.random() * Math.PI * 2,
          r,
          g,
          b,
        };
      });
    };

    build();
    window.addEventListener("resize", build);

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.phase += s.speed;
        const alpha = s.baseAlpha * (0.5 + 0.5 * Math.sin(s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.r | 0},${s.g | 0},${s.b | 0},${alpha.toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", build);
    };
  }, [count]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 h-full w-full"
      style={{ opacity: 0.6, zIndex: 0 }}
    />
  );
}
