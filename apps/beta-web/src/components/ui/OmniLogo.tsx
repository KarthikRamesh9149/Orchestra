export default function OmniLogo({ size = 52 }: { size?: number }) {
  const dots = Array.from({ length: 12 })
  return (
    <>
      <style>{`
        @keyframes spin-ring { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes eye-move { 0%,20%{transform:translateX(0)} 25%,45%{transform:translateX(2px)} 50%,70%{transform:translateX(-2px)} 75%,100%{transform:translateX(0)} }
        @keyframes blink { 0%,89%,100%{transform:scaleY(1)} 90%,95%{transform:scaleY(0.1)} }
        .spin { animation: spin-ring 10s linear infinite; }
        .eye { animation: eye-move 4s ease-in-out infinite, blink 5s ease-in-out infinite; }
      `}</style>
      <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
        <div className="spin" style={{ position: 'absolute', inset: 0 }}>
          {dots.map((_, i) => {
            const angle = (i / 12) * 2 * Math.PI
            const r = size * 0.44
            const ds = size * 0.12
            return (
              <div key={i} style={{
                position: 'absolute',
                width: ds, height: ds,
                borderRadius: '35%',
                background: '#1A1612',
                opacity: 0.28 + (i % 4) * 0.12,
                left: size/2 + r * Math.cos(angle) - ds/2,
                top: size/2 + r * Math.sin(angle) - ds/2,
              }}/>
            )
          })}
        </div>
        <div style={{
          position: 'absolute',
          inset: '20%',
          borderRadius: '50%',
          background: '#FAF8F5',
          border: '1px solid rgba(26,22,18,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: size * 0.09,
        }}>
          {[0,1].map(i => (
            <div key={i} className="eye" style={{
              width: size * 0.1,
              height: size * 0.14,
              borderRadius: '50%',
              background: '#1A1612',
            }}/>
          ))}
        </div>
      </div>
    </>
  )
}
