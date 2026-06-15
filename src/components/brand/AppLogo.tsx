import {
  APP_NAME,
  APP_TAGLINE,
  LOGO_PNG,
  LOGO_SIZES,
  type LogoSize,
} from "../../lib/brand";

type AppLogoProps = {
  size?: LogoSize;
  showWordmark?: boolean;
  subtitle?: string;
  className?: string;
  imageClassName?: string;
};

export function AppLogo({
  size = "sm",
  showWordmark = false,
  subtitle,
  className = "",
  imageClassName = "",
}: AppLogoProps) {
  const dimension = LOGO_SIZES[size];

  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      <img
        src={LOGO_PNG}
        alt={`${APP_NAME} logo`}
        width={dimension}
        height={dimension}
        draggable={false}
        className={[
          "shrink-0 rounded-[10px] object-contain shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06]",
          imageClassName,
        ].join(" ")}
      />

      {showWordmark && (
        <div className="min-w-0">
          <p className="truncate text-[13px] leading-tight font-semibold text-[#f8f9fa]">
            {APP_NAME}
          </p>
          <p className="truncate text-[10px] leading-tight text-neutral-400">
            {subtitle ?? APP_TAGLINE}
          </p>
        </div>
      )}
    </div>
  );
}

export function AppLogoMark({
  size = "sm",
  className = "",
}: {
  size?: LogoSize;
  className?: string;
}) {
  return <AppLogo size={size} className={className} />;
}
