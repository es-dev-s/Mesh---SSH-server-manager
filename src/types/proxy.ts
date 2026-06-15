export type NginxProxyEntry = {
  domain: string;
  targetHost: string;
  targetPort: number;
  configFile: string;
  pm2App: string | null;
  listenPort: number;
};

export type UnproxiedPm2App = {
  name: string;
  port: number;
  pid: number | null;
};

export type ListeningPort = {
  port: number;
  process: string | null;
  pm2App: string | null;
  proxied: boolean;
};

export type NginxProxyOverview = {
  proxies: NginxProxyEntry[];
  unproxiedApps: UnproxiedPm2App[];
  listeningPorts: ListeningPort[];
  dnsIp: string;
  passwordlessSudo: boolean;
  fetchedAt: string;
};

export type DnsInstructions = {
  domain: string;
  recordType: string;
  name: string;
  ipv4: string;
  proxyStatus: string;
  certbotCommand: string;
};

export type StageProxyResult = {
  domain: string;
  port: number;
  stagedPath: string;
  targetConfigFile: string;
  applyMethod: string;
  configContent: string;
  applyCommands: string[];
  dns: DnsInstructions;
  portListening: boolean;
  portAlreadyProxied: boolean;
  websocketEnabled: boolean;
};

export type CreateProxyResult = {
  domain: string;
  port: number;
  applied: boolean;
  autoApplied: boolean;
  stagedPath: string;
  targetConfigFile: string;
  applyMethod: string;
  configContent: string;
  applyCommands: string[];
  dns: DnsInstructions;
  portListening: boolean;
  portAlreadyProxied: boolean;
  message: string;
};

export type DnsCheckResult = {
  domain: string;
  expectedIp: string;
  resolved: boolean;
  addresses: string[];
};

export type NginxReloadResult = {
  reloaded: boolean;
  message: string;
  command: string;
};

export type RemoveProxyResult = {
  domain: string;
  removed: boolean;
  autoRemoved: boolean;
  configFile: string;
  applyCommands: string[];
  message: string;
};

export const PROTECTED_PROXY_DOMAINS = [
  "app.salesradar.live",
  "time.salesradar.live",
  "salesradar.live",
  "www.salesradar.live",
] as const;
