export const APP_NAME = "Mesh";
export const APP_TAGLINE = "Server Workspace";

export const LOGO_PNG = "/logo.png";
export const LOGO_ICO = "/logo.ico";
export const APPLE_TOUCH_ICON = "/apple-touch-icon.png";

export const LOGO_SIZES = {
  xs: 18,
  sm: 28,
  md: 36,
  lg: 48,
  xl: 64,
} as const;

export type LogoSize = keyof typeof LOGO_SIZES;
