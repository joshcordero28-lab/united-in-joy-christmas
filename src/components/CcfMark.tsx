export function CcfMark({
  variant = "red",
  className = "",
}: {
  variant?: "red" | "cream" | "white";
  className?: string;
}) {
  const circle = variant === "red" ? "#B20000" : variant === "white" ? "#FAF7F2" : "#FAF7F2";
  const ccf = variant === "white" ? "#B20000" : "#FAF7F2";
  const text =
    variant === "red" ? "#B20000" : variant === "white" ? "#FAF7F2" : "#B20000";

  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="ccf THAILAND">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
        <circle cx="17" cy="17" r="16" fill={circle} />
        <text
          x="17"
          y="21.5"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill={ccf}
          fontFamily="Georgia, serif"
        >
          ccf
        </text>
      </svg>
      <span
        className="text-[0.7rem] font-extrabold uppercase tracking-[0.18em]"
        style={{ color: text }}
      >
        Thailand
      </span>
    </span>
  );
}
