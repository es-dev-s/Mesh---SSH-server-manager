import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRequestSequencer } from "../../lib/sync";
import { useSshStore } from "../../hooks/useSshMonitor";
import type {
  CreateProxyResult,
  DnsCheckResult,
  NginxProxyOverview,
  NginxReloadResult,
  RemoveProxyResult,
} from "../../types/proxy";

const PROXY_REFRESH_MS = 30_000;

export function useProxyOverview() {
  const snapshot = useSshStore((state) => state.snapshot);
  const isConnected = snapshot.state === "connected";
  const requestSequencer = useRef(createRequestSequencer());

  const [overview, setOverview] = useState<NginxProxyOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isConnected) {
      setError("Connect to the server before managing proxies.");
      return;
    }

    const requestId = requestSequencer.current.next();
    setLoading(true);
    setError(null);

    try {
      const next = await invoke<NginxProxyOverview>("list_nginx_proxies");
      if (!requestSequencer.current.isLatest(requestId)) {
        return;
      }
      setOverview(next);
    } catch (err) {
      if (!requestSequencer.current.isLatest(requestId)) {
        return;
      }
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
    if (!isConnected) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, PROXY_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [isConnected, refresh]);

  return {
    overview,
    loading,
    error,
    refresh,
    isConnected,
  };
}

export async function createProxyRequest(
  domain: string,
  port: number,
  websocketEnabled: boolean,
): Promise<CreateProxyResult> {
  return invoke<CreateProxyResult>("create_nginx_proxy", {
    domain,
    port,
    websocketEnabled,
  });
}

export async function checkDnsRequest(
  domain: string,
  expectedIp: string,
): Promise<DnsCheckResult> {
  return invoke<DnsCheckResult>("check_dns_resolution", {
    domain,
    expectedIp,
  });
}

export async function reloadNginxRequest(): Promise<NginxReloadResult> {
  return invoke("reload_nginx");
}

export async function removeProxyRequest(domain: string): Promise<RemoveProxyResult> {
  return invoke<RemoveProxyResult>("remove_nginx_proxy", {
    domain,
  });
}
