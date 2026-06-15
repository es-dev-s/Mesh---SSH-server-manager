import type { FileKind } from "./server-file-system";

const palette: Record<FileKind, { body: string; fold: string; label: string }> =
  {
    doc: { body: "#FFFFFF", fold: "#E8E8ED", label: "#007AFF" },
    code: { body: "#F8F8FA", fold: "#E5E5EA", label: "#5856D6" },
    config: { body: "#FFF9F0", fold: "#F2E8D8", label: "#FF9500" },
    log: { body: "#F4F4F5", fold: "#E4E4E7", label: "#8E8E93" },
    image: { body: "#F0FAFF", fold: "#D6EFFF", label: "#32ADE6" },
    archive: { body: "#F5F0FF", fold: "#E8DDF8", label: "#AF52DE" },
  };

const kindLabel: Record<FileKind, string> = {
  doc: "DOC",
  code: "TS",
  config: "CFG",
  log: "LOG",
  image: "IMG",
  archive: "ZIP",
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
      className="shrink-0 drop-shadow-[0_2px_5px_rgba(0,0,0,0.08)]"
    >
      <path
        d="M10 4H30L42 16V52C42 54.2091 40.2091 56 38 56H10C7.79086 56 6 54.2091 6 52V8C6 5.79086 7.79086 4 10 4Z"
        fill={colors.body}
        stroke="#000000"
        strokeOpacity="0.06"
        strokeWidth="1"
      />
      <path
        d="M30 4V14C30 15.1046 30.8954 16 32 16H42L30 4Z"
        fill={colors.fold}
        stroke="#000000"
        strokeOpacity="0.05"
        strokeWidth="1"
      />
      <rect
        x="12"
        y="30"
        width="22"
        height="3"
        rx="1.5"
        fill="#000000"
        fillOpacity="0.06"
      />
      <rect
        x="12"
        y="36"
        width="16"
        height="3"
        rx="1.5"
        fill="#000000"
        fillOpacity="0.04"
      />
      <text
        x="26"
        y="24"
        textAnchor="middle"
        fill={colors.label}
        fontSize="9"
        fontWeight="700"
        fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
      >
        {kindLabel[kind]}
      </text>
    </svg>
  );
}
