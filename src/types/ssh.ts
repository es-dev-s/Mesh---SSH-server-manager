export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "misconfigured";

export type DeviceSpecs = {
  hostname: string;
  osName: string;
  kernel: string;
  architecture: string;
  cpuModel: string;
  cpuCores: number;
  cpuThreads: number;
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  memoryAvailableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  uptimeSeconds: number;
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
};

export type StorageVolume = {
  filesystem: string;
  mountPoint: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
};

export type StorageSummary = {
  physicalTotalBytes: number;
  filesystemTotalBytes: number;
  filesystemUsedBytes: number;
  filesystemAvailableBytes: number;
  filesystemUsedPercent: number;
  volumes: StorageVolume[];
};

export type RemoteEntry = {
  name: string;
  entryType: string;
  kind: string;
};

export type Pm2Process = {
  id: number;
  name: string;
  status: string;
  pid: number | null;
  interpreter: string;
  execMode: string;
  cwd: string;
  scriptPath: string;
  args: string;
  memoryBytes: number;
  cpuPercent: number;
  restarts: number;
  uptimeMs: number;
  version: string;
  description: string;
};

export type Pm2Summary = {
  installed: boolean;
  version: string | null;
  runningCount: number;
  totalCount: number;
  processes: Pm2Process[];
};

export type SshSnapshot = {
  state: ConnectionState;
  name: string;
  user: string;
  host: string;
  port: number;
  lastConnectedAt: string | null;
  lastUpdatedAt: string | null;
  lastError: string | null;
  statusMessage: string | null;
  reconnectAttempts: number;
  revision: number;
  sessionId: number;
  specs: DeviceSpecs | null;
  storage: StorageSummary | null;
  pm2: Pm2Summary | null;
};
