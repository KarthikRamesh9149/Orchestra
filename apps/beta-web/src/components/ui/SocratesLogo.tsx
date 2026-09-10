interface SocratesLogoProps {
  className?: string;
  size?: number;
}

export function SocratesLogo({ className = "", size = 40 }: SocratesLogoProps) {
  const dots = Array.from({ length: 12 });
  const radius = size * 0.6;
  const dotSize = size * 0.18;

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size * 2, height: size * 2 }}
    >
      {/* Rotating dot ring */}
      <div className="socrates-ring absolute inset-0">
        {dots.map((_, index) => {
          const angle = (index * 360) / 12;
          const radian = (angle * Math.PI) / 180;
          const x = Math.round(Math.cos(radian) * radius * 100) / 100;
          const y = Math.round(Math.sin(radian) * radius * 100) / 100;
          return (
            <div
              key={index}
              className="absolute bg-current"
              style={{
                width: `${dotSize}px`,
                height: `${dotSize}px`,
                borderRadius: "35%",
                left: "50%",
                top: "50%",
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${angle}deg)`,
              }}
            />
          );
        })}
      </div>

      {/* Eyes */}
      <div className="socrates-eyes relative z-10 flex" style={{ gap: `${dotSize * 0.46}px` }}>
        <div
          className="bg-current"
          style={{ width: `${dotSize * 1.2}px`, height: `${dotSize * 2.5}px`, borderRadius: "4px" }}
        />
        <div
          className="bg-current"
          style={{ width: `${dotSize * 1.2}px`, height: `${dotSize * 2.5}px`, borderRadius: "4px" }}
        />
      </div>
    </div>
  );
}
