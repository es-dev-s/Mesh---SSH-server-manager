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
      className="shrink-0 drop-shadow-[0_3px_10px_rgba(0,84,200,0.32)]"
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
          <stop stopColor="#0055D4" />
          <stop offset="1" stopColor="#007AFF" />
        </linearGradient>
        <linearGradient
          id={`${gradientId}-front`}
          x1="28"
          y1="10"
          x2="28"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4DB2FF" />
          <stop offset="0.5" stopColor="#2B9AFF" />
          <stop offset="1" stopColor="#1488F0" />
        </linearGradient>
        <linearGradient
          id={`${gradientId}-tab`}
          x1="16"
          y1="4"
          x2="16"
          y2="12"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#7EC8FF" />
          <stop offset="1" stopColor="#52B0F8" />
        </linearGradient>
      </defs>

      <path
        d="M4 10C4 7.79086 5.79086 6 8 6H20.5L25 10H48C50.2091 10 52 11.7909 52 14V38C52 40.2091 50.2091 42 48 42H8C5.79086 42 4 40.2091 4 38V10Z"
        fill={`url(#${gradientId}-back)`}
      />
      <path
        d="M4 14C4 11.7909 5.79086 10 8 10H22L26.5 14H48C50.2091 14 52 15.7909 52 18V38C52 40.2091 50.2091 42 48 42H8C5.79086 42 4 40.2091 4 38V14Z"
        fill={`url(#${gradientId}-front)`}
        stroke="#005BBF"
        strokeOpacity="0.18"
        strokeWidth="0.6"
      />
      <path
        d="M8 6H20.5L25 10H8C5.79086 10 4 8.20914 4 6V6C4 6 5.79086 6 8 6Z"
        fill={`url(#${gradientId}-tab)`}
        stroke="#0068CC"
        strokeOpacity="0.12"
        strokeWidth="0.5"
      />
      <path
        d="M8 17H48V24C48 24.5523 47.5523 25 47 25H9C8.44772 25 8 24.5523 8 24V17Z"
        fill="white"
        fillOpacity="0.18"
      />
    </svg>
  );
}
