export function FolderIcon({ size = 64 }: { size?: number }) {
  const height = Math.round(size * 0.82);
  const width = size;
  const gradientId = `folder-${size}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 56 46"
      fill="none"
      aria-hidden
      className="shrink-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
    >
      <defs>
        <linearGradient
          id={`${gradientId}-back`}
          x1="28"
          y1="6"
          x2="28"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#202020" />
          <stop offset="1" stopColor="#141414" />
        </linearGradient>
        <linearGradient
          id={`${gradientId}-front`}
          x1="28"
          y1="10"
          x2="28"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#444444" />
          <stop offset="0.5" stopColor="#2c2c2c" />
          <stop offset="1" stopColor="#1e1e1e" />
        </linearGradient>
        <linearGradient
          id={`${gradientId}-tab`}
          x1="16"
          y1="4"
          x2="16"
          y2="12"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#666666" />
          <stop offset="1" stopColor="#3a3a3a" />
        </linearGradient>
      </defs>

      <path
        d="M4 10C4 7.79086 5.79086 6 8 6H20.5L25 10H48C50.2091 10 52 11.7909 52 14V38C52 40.2091 50.2091 42 48 42H8C5.79086 42 4 40.2091 4 38V10Z"
        fill={`url(#${gradientId}-back)`}
      />
      <path
        d="M4 14C4 11.7909 5.79086 10 8 10H22L26.5 14H48C50.2091 14 52 15.7909 52 18V38C52 40.2091 50.2091 42 48 42H8C5.79086 42 4 40.2091 4 38V14Z"
        fill={`url(#${gradientId}-front)`}
        stroke="#ffffff"
        strokeOpacity="0.1"
        strokeWidth="0.6"
      />
      <path
        d="M8 6H20.5L25 10H8C5.79086 10 4 8.20914 4 6V6C4 6 5.79086 6 8 6Z"
        fill={`url(#${gradientId}-tab)`}
        stroke="#ffffff"
        strokeOpacity="0.08"
        strokeWidth="0.5"
      />
      <path
        d="M8 17H48V24C48 24.5523 47.5523 25 47 25H9C8.44772 25 8 24.5523 8 24V17Z"
        fill="white"
        fillOpacity="0.05"
      />
    </svg>
  );
}
