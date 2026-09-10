import { useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  radius: number;
  opacity: number;
  color: string;
}

export interface SocratesIdleProps {
  state: "idle" | "typing" | "generating";
  size?: number;
}

// Use the actual app accent colors
const PARTICLE_COLORS = ["#2A9D8F", "#7C6FD9", "#E5A663", "#2A9D8F", "#2A9D8F"];

const CONNECT_DIST = 72;
const BREATHE_SPEED = 0.0008;
const BREATHE_AMP = 12;

export function SocratesIdle({ state, size = 320 }: SocratesIdleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const prefersReducedMotion = useReducedMotion();

  const initParticles = useCallback(
    (cx: number, cy: number) => {
      particlesRef.current = Array.from({ length: 28 }, (_, i) => {
        const angle = -Math.PI * 0.6 + (i / 27) * Math.PI * 1.2;
        const r = 80 + (i % 7) * 6; // deterministic spread instead of Math.random
        const bx = cx + r * Math.cos(angle);
        const by = cy - 30 + r * Math.sin(angle) * 0.6;
        const jx = ((i * 17) % 20) - 10; // deterministic jitter
        const jy = ((i * 13) % 20) - 10;
        return {
          x: bx + jx,
          y: by + jy,
          vx: ((i % 5) - 2) * 0.06,
          vy: ((i % 3) - 1) * 0.06,
          baseX: bx,
          baseY: by,
          radius: 2 + (i % 3),
          opacity: 0.4 + (i % 5) * 0.12,
          color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
        };
      });
    },
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cx = size / 2;
    const cy = size / 2;
    initParticles(cx, cy);

    if (prefersReducedMotion) {
      // Static render for reduced-motion users
      ctx.clearRect(0, 0, size, size);
      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.baseX - b.baseX;
          const dy = a.baseY - b.baseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECT_DIST) {
            const alpha = (1 - dist / CONNECT_DIST) * 0.18;
            ctx.beginPath();
            ctx.moveTo(a.baseX, a.baseY);
            ctx.lineTo(b.baseX, b.baseY);
            ctx.strokeStyle = `rgba(42,157,143,${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.baseX, p.baseY, p.radius, 0, Math.PI * 2);
        const opHex = Math.round(p.opacity * 255)
          .toString(16)
          .padStart(2, "0");
        ctx.fillStyle = p.color + opHex;
        ctx.fill();
      });
      if (state === "idle") {
        ctx.font = '500 13px "Geist Mono", monospace';
        ctx.fillStyle = "rgba(42,157,143,0.7)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("SOCRATES", cx, cy + 20);
        ctx.font = '300 11px "Geist", sans-serif';
        ctx.fillStyle = "rgba(138,131,120,0.6)";
        ctx.fillText("Ask anything about your project", cx, cy + 40);
      }
      return;
    }

    const draw = (ts: number) => {
      ctx.clearRect(0, 0, size, size);
      const particles = particlesRef.current;
      const breathe = Math.sin(ts * BREATHE_SPEED) * BREATHE_AMP;

      particles.forEach((p) => {
        const targetX =
          p.baseX + Math.cos(ts * 0.0005 + p.baseX * 0.01) * breathe * 0.4;
        const targetY =
          p.baseY + Math.sin(ts * 0.0005 + p.baseY * 0.01) * breathe * 0.4;
        p.vx += (targetX - p.x) * 0.015;
        p.vy += (targetY - p.y) * 0.015;
        p.vx *= 0.88;
        p.vy *= 0.88;
        p.x += p.vx;
        p.y += p.vy;

        if (state === "generating") {
          const orbitAngle = ts * 0.002;
          p.x += Math.cos(orbitAngle) * 0.5;
          p.y += Math.sin(orbitAngle) * 0.5;
        }

        if (state === "typing") {
          p.vx += (cx - p.x) * 0.004;
          p.vy += (cy - p.y) * 0.004;
        }
      });

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECT_DIST) {
            const alpha = (1 - dist / CONNECT_DIST) * 0.18;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(42,157,143,${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      // Draw particles
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        const opHex = Math.round(p.opacity * 255)
          .toString(16)
          .padStart(2, "0");
        ctx.fillStyle = p.color + opHex;
        ctx.fill();
      });

      // Central mark in idle state
      if (state === "idle") {
        ctx.font = '500 13px "Geist Mono", monospace';
        ctx.fillStyle = "rgba(42,157,143,0.7)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("SOCRATES", cx, cy + 20);
        ctx.font = '300 11px "Geist", sans-serif';
        ctx.fillStyle = "rgba(138,131,120,0.6)";
        ctx.fillText("Ask anything about your project", cx, cy + 40);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [state, size, initParticles, prefersReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="select-none"
      aria-hidden="true"
    />
  );
}
