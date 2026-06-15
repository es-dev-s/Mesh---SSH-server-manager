export type DeployStep = {
  label: string;
  success: boolean;
  detail: string;
};

export type DeployResult = {
  appName: string;
  repoUrl: string;
  deployDir: string;
  pm2Name: string;
  success: boolean;
  steps: DeployStep[];
  port: number | null;
  localUrl: string | null;
  serverHost: string;
  message: string;
};

export type DeploymentEntry = {
  appName: string;
  repoUrl: string | null;
  deployDir: string;
  pm2Name: string;
  pm2Status: string | null;
  port: number | null;
  localUrl: string | null;
};

export type DeployOverview = {
  deployments: DeploymentEntry[];
  serverHost: string;
  deployRoot: string;
  fetchedAt: string;
};

export type RemoveDeployResult = {
  appName: string;
  removed: boolean;
  message: string;
};
