export const PROXY_BASE_DOMAIN = "salesradar.live";

export function normalizeSubdomain(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export function buildFullDomain(subdomain: string): string {
  const slug = normalizeSubdomain(subdomain);
  return slug ? `${slug}.${PROXY_BASE_DOMAIN}` : PROXY_BASE_DOMAIN;
}

export function validateSubdomain(subdomain: string): string | null {
  const slug = normalizeSubdomain(subdomain);
  if (!slug) {
    return "Choose a subdomain name (e.g. crm, api, staging).";
  }
  if (slug.length > 63) {
    return "Subdomain must be 63 characters or fewer.";
  }
  if (slug.startsWith("-") || slug.endsWith("-")) {
    return "Subdomain cannot start or end with a hyphen.";
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return "Use letters, numbers, and hyphens only.";
  }
  return null;
}

export function suggestSubdomainFromAppName(name: string): string {
  return normalizeSubdomain(name.replace(/_/g, "-"));
}

export function cloudflareRecordName(fullDomain: string): string {
  if (!fullDomain.endsWith(`.${PROXY_BASE_DOMAIN}`)) {
    return fullDomain.split(".")[0] ?? fullDomain;
  }
  return fullDomain.slice(0, -(PROXY_BASE_DOMAIN.length + 1));
}

/** Lines safe to paste into a bash terminal (skip Mesh comment headers). */
export function executableApplyCommands(commands: string[]): string[] {
  return commands.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  });
}
