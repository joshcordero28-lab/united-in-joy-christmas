const WORDS = [
  { text: "Family", top: "8%", left: "6%", rotate: "-8deg" },
  { text: "Friendship", top: "18%", left: "55%", rotate: "6deg" },
  { text: "Community", top: "36%", left: "8%", rotate: "4deg" },
  { text: "Grace", top: "48%", left: "62%", rotate: "-5deg" },
  { text: "Joy", top: "62%", left: "18%", rotate: "8deg" },
  { text: "Hope", top: "72%", left: "70%", rotate: "-3deg" },
  { text: "Love", top: "28%", left: "35%", rotate: "-10deg" },
  { text: "Mercy", top: "82%", left: "40%", rotate: "5deg" },
];

export function ScriptWatermark() {
  return (
    <div className="hero-watermark" aria-hidden>
      {WORDS.map((w) => (
        <span
          key={w.text}
          style={{ top: w.top, left: w.left, transform: `rotate(${w.rotate})` }}
        >
          {w.text}
        </span>
      ))}
    </div>
  );
}
