export function Sparkles() {
  const dots = [
    { top: "8%", left: "12%", delay: "0s" },
    { top: "18%", left: "78%", delay: "0.6s" },
    { top: "42%", left: "88%", delay: "1.1s" },
    { top: "70%", left: "8%", delay: "1.7s" },
    { top: "28%", left: "40%", delay: "2.2s" },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {dots.map((d) => (
        <span
          key={`${d.top}-${d.left}`}
          className="sparkle"
          style={{ top: d.top, left: d.left, animationDelay: d.delay }}
        />
      ))}
    </div>
  );
}
