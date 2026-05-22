/**
 * Ambient dot-grid background — same algorithm as the website's hero
 * canvas and the extension's popup. Mounted once at the app root with
 * `position: fixed` behind the UI. Respects prefers-reduced-motion.
 */
import { useEffect, useRef } from "preact/hooks";

const CONFIG = { dotSpacing: 30, dotHoverRadius: 130 };

export function DotGrid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mouse = { x: -9999, y: -9999, active: false };

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let centreX = 0;
    let centreY = 0;
    let dots: { x: number; y: number; base: number }[] = [];

    let dotColour = readDotColour();
    function readDotColour(): string {
      return (
        getComputedStyle(document.documentElement).getPropertyValue("--color-dot").trim() ||
        "0.28 0.004 260"
      );
    }
    const themeObserver = new MutationObserver(() => {
      dotColour = readDotColour();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    function resize(): void {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      centreX = width / 2;
      centreY = height / 2;
      build();
    }

    function build(): void {
      dots = [];
      const spacing = CONFIG.dotSpacing;
      const maxR = Math.hypot(width, height) / 2;
      const cols = Math.ceil(width / spacing) + 2;
      const rows = Math.ceil(height / spacing) + 2;
      const offX = (width - (cols - 1) * spacing) / 2;
      const offY = (height - (rows - 1) * spacing) / 2;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = offX + i * spacing;
          const y = offY + j * spacing;
          const distFromCentre = Math.hypot(x - centreX, y - centreY);
          const t = Math.min(distFromCentre / (maxR * 0.85), 1);
          const base = 0.06 + (1 - t) * 0.18;
          dots.push({ x, y, base });
        }
      }
    }

    let rafId = 0;
    let paused = false;
    function frame(): void {
      if (paused) return;
      ctx!.clearRect(0, 0, width, height);
      const hoverR = CONFIG.dotHoverRadius;
      const hoverR2 = hoverR * hoverR;
      for (const d of dots) {
        let a = d.base;
        if (mouse.active && !reducedMotion) {
          const dx = d.x - mouse.x;
          const dy = d.y - mouse.y;
          const sq = dx * dx + dy * dy;
          if (sq < hoverR2) {
            const t = 1 - Math.sqrt(sq) / hoverR;
            a += t * 0.65;
          }
        }
        if (a < 0.02) continue;
        const size = a > 0.5 ? 1.5 : 1.1;
        ctx!.fillStyle = `oklch(${dotColour} / ${Math.min(a, 0.95)})`;
        ctx!.beginPath();
        ctx!.arc(d.x, d.y, size, 0, Math.PI * 2);
        ctx!.fill();
      }
      rafId = requestAnimationFrame(frame);
    }

    const onMove = (event: MouseEvent): void => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
      mouse.active = true;
    };
    const onLeave = (): void => {
      mouse.active = false;
    };
    const onVisibility = (): void => {
      if (document.hidden) {
        paused = true;
        cancelAnimationFrame(rafId);
      } else if (paused) {
        paused = false;
        rafId = requestAnimationFrame(frame);
      }
    };

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);

    resize();
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      themeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        class="pointer-events-none fixed inset-0 z-0 h-full w-full"
      />
      <div
        aria-hidden="true"
        class="pointer-events-none fixed inset-0 z-0"
        style="background: radial-gradient(ellipse 85% 70% at 50% 50%, transparent 0%, transparent 35%, var(--vignette-stop) 80%, var(--vignette-edge) 100%);"
      />
      <div
        aria-hidden="true"
        class="pointer-events-none fixed inset-0 z-0"
        style={`opacity: var(--grain-opacity); mix-blend-mode: var(--grain-mix); background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");`}
      />
    </>
  );
}
