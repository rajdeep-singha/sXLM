import { useEffect, useRef, useCallback } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  angle: number;
  spin: number;
  distance: number;
  targetDistance: number;
}

interface PixelBlastProps {
  className?: string;
  particleCount?: number;
  colors?: string[];
  interactive?: boolean;
}

export function PixelBlast({
  className = '',
  particleCount = 200,
  colors = ['#F5CF00', '#FFD700', '#FFA500', '#E6B800', '#FFED4A', '#D4A800'],
  interactive = true,
}: PixelBlastProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: 0, y: 0, active: false });
  const animationRef = useRef<number>();
  const centerRef = useRef({ x: 0, y: 0 });

  const createParticle = useCallback(
    (cx: number, cy: number, burst = false): Particle => {
      const angle = Math.random() * Math.PI * 2;
      const distance = burst ? Math.random() * 50 : Math.random() * 300 + 100;
      const targetDistance = Math.random() * 400 + 150;
      const speed = burst ? Math.random() * 8 + 4 : Math.random() * 2 + 0.5;

      return {
        x: cx + Math.cos(angle) * distance,
        y: cy + Math.sin(angle) * distance,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 4 + 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: Math.random() * 0.8 + 0.2,
        life: 0,
        maxLife: Math.random() * 200 + 100,
        angle,
        spin: (Math.random() - 0.5) * 0.02,
        distance,
        targetDistance,
      };
    },
    [colors]
  );

  const initParticles = useCallback(
    (width: number, height: number) => {
      const cx = width / 2;
      const cy = height / 2;
      centerRef.current = { x: cx, y: cy };

      particlesRef.current = Array.from({ length: particleCount }, () =>
        createParticle(cx, cy)
      );
    },
    [particleCount, createParticle]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      initParticles(rect.width, rect.height);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };

    const handleClick = (e: MouseEvent) => {
      if (!interactive) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Create burst particles on click
      for (let i = 0; i < 30; i++) {
        particlesRef.current.push(createParticle(clickX, clickY, true));
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('click', handleClick);

    const animate = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Draw wormhole glow at center
      const cx = centerRef.current.x;
      const cy = centerRef.current.y;

      // Outer glow - Stellar yellow
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200);
      gradient.addColorStop(0, 'rgba(245, 207, 0, 0.15)');
      gradient.addColorStop(0.5, 'rgba(255, 215, 0, 0.05)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Draw connecting lines between nearby particles
      ctx.strokeStyle = 'rgba(245, 207, 0, 0.1)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particlesRef.current.length; i++) {
        const p1 = particlesRef.current[i];
        for (let j = i + 1; j < particlesRef.current.length; j++) {
          const p2 = particlesRef.current[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 80) {
            ctx.globalAlpha = (1 - dist / 80) * 0.3;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      // Update and draw particles
      particlesRef.current = particlesRef.current.filter((p) => {
        p.life++;

        // Spiral motion around center
        p.angle += p.spin;
        p.distance += (p.targetDistance - p.distance) * 0.01;

        // Base position from spiral
        const baseX = cx + Math.cos(p.angle) * p.distance;
        const baseY = cy + Math.sin(p.angle) * p.distance;

        // Add velocity
        p.x += (baseX - p.x) * 0.02 + p.vx;
        p.y += (baseY - p.y) * 0.02 + p.vy;

        // Friction
        p.vx *= 0.98;
        p.vy *= 0.98;

        // Mouse interaction
        if (interactive && mouseRef.current.active) {
          const dx = p.x - mouseRef.current.x;
          const dy = p.y - mouseRef.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            const force = (150 - dist) / 150;
            p.vx += (dx / dist) * force * 0.5;
            p.vy += (dy / dist) * force * 0.5;
          }
        }

        // Pulsing alpha
        const lifeFactor = p.life / p.maxLife;
        const pulse = Math.sin(p.life * 0.05) * 0.3 + 0.7;
        const alpha = p.alpha * pulse * (lifeFactor < 0.1 ? lifeFactor * 10 : lifeFactor > 0.9 ? (1 - lifeFactor) * 10 : 1);

        // Draw particle with glow
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = alpha;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Respawn if life exceeded
        if (p.life >= p.maxLife) {
          const newP = createParticle(cx, cy);
          Object.assign(p, newP);
        }

        return true;
      });

      // Maintain particle count
      while (particlesRef.current.length < particleCount) {
        particlesRef.current.push(createParticle(cx, cy));
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleClick);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [particleCount, initParticles, createParticle, interactive]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 ${className}`}
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
    />
  );
}