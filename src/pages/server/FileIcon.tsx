import type { FileKind } from "./server-file-system";

const palette: Record<FileKind, { body: string; fold: string; label: string }> =
  {
    doc: { body: "#242428", fold: "#3a3a40", label: "#ffffff" },
    code: { body: "#1e1e22", fold: "#323236", label: "#ffffff" },
    config: { body: "#2a2a2e", fold: "#404046", label: "#e5e5ea" },
    log: { body: "#18181c", fold: "#2a2a2e", label: "#a1a1a6" },
    image: { body: "#202024", fold: "#34343a", label: "#ffffff" },
    archive: { body: "#1c1c20", fold: "#2f2f35", label: "#d1d1d6" },
  };

const kindLabel: Record<FileKind, string> = {
  doc: "DOC",
  code: "CODE",
  config: "CONF",
  log: "LOG",
  image: "IMG",
  archive: "ARC",
};

export function FileIcon({
  kind,
  size = 52,
}: {
  kind: FileKind;
  size?: number;
}) {
  const colors = palette[kind];
  const height = Math.round(size * 1.15);
  const width = size;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 52 60"
      fill="none"
      aria-hidden
      className="shrink-0 drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]"
    >
      <path
        d="M10 4H30L42 16V52C42 54.2091 40.2091 56 38 56H10C7.79086 56 6 54.2091 6 52V8C6 5.79086 7.79086 4 10 4Z"
        fill={colors.body}
        stroke="#ffffff"
        strokeOpacity="0.08"
        strokeWidth="1"
      />
      <path
        d="M30 4V14C30 15.1046 30.8954 16 32 16H42L30 4Z"
        fill={colors.fold}
        stroke="#ffffff"
        strokeOpacity="0.06"
        strokeWidth="1"
      />
      <rect
        x="12"
        y="30"
        width="22"
        height="3"
        rx="1.5"
        fill="#ffffff"
        fillOpacity="0.08"
      />
      <rect
        x="12"
        y="36"
        width="16"
        height="3"
        rx="1.5"
        fill="#ffffff"
        fillOpacity="0.05"
      />
      <text
        x="26"
        y="24"
        textAnchor="middle"
        fill={colors.label}
        fontSize="8.5"
        fontWeight="700"
        letterSpacing="0.05em"
        fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
      >
        {kindLabel[kind]}
      </text>
    </svg>
  );
}
