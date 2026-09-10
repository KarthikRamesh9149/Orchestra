import { clsx } from "clsx";

interface OmniLogoProps {
  className?: string;
  size?: number;
}

const CSS = `
@keyframes omni-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes omni-eye-move {
  0%, 100% { transform: translateX(0); }
  20%       { transform: translateX(-3px); }
  40%       { transform: translateX(3px); }
  60%       { transform: translateY(-2px); }
  80%       { transform: translateY(2px); }
}
@keyframes omni-blink {
  0%, 90%, 100% { transform: scaleY(1); }
  95%           { transform: scaleY(0.1); }
}
.omni-ring  { animation: omni-spin      12s linear      infinite; }
.omni-eyes  { animation: omni-eye-move  4s  ease-in-out infinite alternate; }
.omni-blink { animation: omni-blink     3s  ease-in-out infinite; }
`;

export function OmniLogo({ className, size = 40 }: OmniLogoProps) {
  const radius  = size * 0.6;
  const dotSize = size * 0.18;

  return (
    <div
      className={clsx("relative flex items-center justify-center", className)}
      style={{ width: size * 2, height: size * 2 }}
    >
      <style>{CSS}</style>

      {/* Spinning dot ring */}
      <div className="absolute inset-0 omni-ring">
        {Array.from({ length: 12 }, (_, i) => {
          const angle  = (i * 360) / 12;
          const radian = (angle * Math.PI) / 180;
          const x = Math.round(Math.cos(radian) * radius * 100) / 100;
          const y = Math.round(Math.sin(radian) * radius * 100) / 100;
          return (
            <div
              key={i}
              className="absolute bg-current"
              style={{
                width:        `${dotSize}px`,
                height:       `${dotSize}px`,
                borderRadius: "35%",
                left:         "50%",
                top:          "50%",
                transform:    `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${angle}deg)`,
              }}
            />
          );
        })}
      </div>

      {/* Eyes */}
      <div className="omni-eyes omni-blink relative z-10 flex" style={{ gap: `${dotSize * 0.46}px` }}>
        <div className="bg-current" style={{ width: `${dotSize * 1.2}px`, height: `${dotSize * 2.5}px`, borderRadius: "4px" }} />
        <div className="bg-current" style={{ width: `${dotSize * 1.2}px`, height: `${dotSize * 2.5}px`, borderRadius: "4px" }} />
      </div>
    </div>
  );
}
