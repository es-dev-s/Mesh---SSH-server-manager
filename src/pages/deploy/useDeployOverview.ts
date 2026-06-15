import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRequestSequencer } from "../../lib/sync";
import { useSshStore } from "../../hooks/useSshMonitor";
import type { DeployOverview, DeployResult, RemoveDeployResult } from "../../types/deploy";

const DEPLOY_REFRESH_MS = 30_000;

export function useDeployOverview() {
  const snapshot = useSshStore((state) => state.snapshot);
  const isConnected = snapshot.state === "connected";
  const requestSequencer = useRef(createRequestSequencer());

  const [overview, setOverview] = useState<DeployOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isConnected) {
      setError("Connect to the server before deploying.");
      return;
    }

    const requestId = requestSequencer.current.next();
    setLoading(true);
    setError(null);

    try {
      const next = await invoke<DeployOverview>("list_deployments");
      if (!requestSequencer.current.isLatest(requestId)) return;
      setOverview(next);
    } catch (err) {
      if (!requestSequencer.current.isLatest(requestId)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestSequencer.current.isLatest(requestId)) {
        setLoading(false);
      }
    }
  }, [isConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh, snapshot.sessionId]);

  useEffect(() => {
    if (!isConnected) return;
    const timer = window.setInterval(() => void refresh(), DEPLOY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isConnected, refresh]);

  return { overview, loading, error, refresh, isConnected };
}

export async function runDeployRequest(input: {
  repoUrl: string;
  buildCommand?: string;
  startCommand: string;
  appName?: string;
  envContent?: string;
}): Promise<DeployResult> {
  return invoke<DeployResult>("run_deploy", {
    repoUrl: input.repoUrl,
    buildCommand: input.buildCommand?.trim() || null,
    startCommand: input.startCommand,
    appName: input.appName?.trim() || null,
    envContent: input.envContent?.trim() || null,
  });
}

export async function readDeployEnvRequest(appName: string): Promise<string> {
  return invoke<string>("read_deploy_env", { appName });
}

export async function pullDeployRequest(appName: string): Promise<DeployResult> {
  return invoke<DeployResult>("pull_deploy", { appName });
}

export async function removeDeploymentRequest(appName: string): Promise<RemoveDeployResult> {
  return invoke<RemoveDeployResult>("remove_deployment", {
    appName,
  });
}
