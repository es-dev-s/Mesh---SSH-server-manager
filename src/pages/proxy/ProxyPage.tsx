import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCw,
  Server,
  Terminal,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CreateProxyPanel } from "./CreateProxyPanel";
import { executableApplyCommands } from "./proxy-domain";
import { ConnectionStatusBadge } from "../dashboard/ConnectionStatusBadge";
import { useSshStore } from "../../hooks/useSshMonitor";
import { useNavigationStore } from "../../stores/useNavigationStore";
import { useServerTabsStore } from "../../stores/useServerTabsStore";
import type {
  CreateProxyResult,
  NginxProxyEntry,
  NginxReloadResult,
  RemoveProxyResult,
} from "../../types/proxy";
import { PROTECTED_PROXY_DOMAINS } from "../../types/proxy";
import { getPageMeta } from "../page-config";
import {
  checkDnsRequest,
  createProxyRequest,
  reloadNginxRequest,
  removeProxyRequest,
  useProxyOverview,
} from "./useProxyOverview";

function cardClassName() {
  return "overflow-hidden rounded-2xl bg-[#1c1c1e]/60 shadow-[0_4px_24px_rgba(0,0,0,0.15)] border border-white/[0.06] backdrop-blur-md";
}

function isProtectedDomain(domain: string) {
  return PROTECTED_PROXY_DOMAINS.some(
    (protectedDomain) => protectedDomain.toLowerCase() === domain.toLowerCase(),
  );
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function ProxyPage() {
  const meta = getPageMeta("proxy");
  const snapshot = useSshStore((state) => state.snapshot);
  const setPage = useNavigationStore((state) => state.setPage);
  const addTab = useServerTabsStore((state) => state.addTab);
  const { overview, loading, error, refresh, isConnected } = useProxyOverview();

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateProxyResult | null>(null);
  const [dnsChecking, setDnsChecking] = useState(false);
  const [dnsResult, setDnsResult] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [reloadingNginx, setReloadingNginx] = useState(false);
  const [reloadResult, setReloadResult] = useState<NginxReloadResult | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [removingDomain, setRemovingDomain] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removeResult, setRemoveResult] = useState<RemoveProxyResult | null>(null);

  const portOptions = useMemo(() => {
    if (!overview) {
      return [];
    }
    const seen = new Set<number>();
    const options: Array<{ port: number; label: string }> = [];

    for (const app of overview.unproxiedApps) {
      if (seen.has(app.port)) continue;
      seen.add(app.port);
      options.push({ port: app.port, label: `${app.port} · ${app.name}` });
    }

    for (const entry of overview.listeningPorts) {
      if (seen.has(entry.port)) continue;
      seen.add(entry.port);
      const label = entry.pm2App
        ? `${entry.port} · ${entry.pm2App}`
        : entry.process
          ? `${entry.port} · ${entry.process}`
          : `${entry.port}`;
      options.push({ port: entry.port, label });
    }

    return options.sort((a, b) => a.port - b.port);
  }, [overview]);

  async function handleCopy(label: string, value: string) {
    await copyText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  }

  function openApplyInTerminal(commands: string[]) {
    const runnable = executableApplyCommands(commands);
    setPage("server");
    addTab({
      type: "terminal",
      id: `proxy-apply-${Date.now()}`,
      title: "Apply Proxy",
      startupCommand: `${runnable.join("\n")}\n`,
    });
  }

  async function handleCreate(domain: string, port: number, websocketEnabled: boolean) {
    setSubmitError(null);
    setResult(null);
    setDnsResult(null);

    setSubmitting(true);
    try {
      const created = await createProxyRequest(domain, port, websocketEnabled);
      setResult(created);
      await refresh();
      if (!created.applied) {
        openApplyInTerminal(created.applyCommands);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(domain: string) {
    if (isProtectedDomain(domain)) return;
    if (!window.confirm(`Remove nginx proxy for ${domain}? Other domains are not affected.`)) {
      return;
    }

    setRemoveError(null);
    setRemoveResult(null);
    setRemovingDomain(domain);
    try {
      const removed = await removeProxyRequest(domain);
      setRemoveResult(removed);
      await refresh();
      if (!removed.removed) {
        openApplyInTerminal(removed.applyCommands);
      }
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingDomain(null);
    }
  }

  async function handleCheckDns() {
    if (!result?.dns) return;
    setDnsChecking(true);
    setDnsResult(null);
    try {
      const check = await checkDnsRequest(result.dns.domain, result.dns.ipv4);
      setDnsResult(
        check.resolved
          ? `DNS resolves to ${result.dns.ipv4}.`
          : check.addresses.length > 0
            ? `Resolved to ${check.addresses.join(", ")} — expected ${result.dns.ipv4}.`
            : "No A record found yet — propagation can take 5–30 minutes.",
      );
    } catch (err) {
      setDnsResult(err instanceof Error ? err.message : String(err));
    } finally {
      setDnsChecking(false);
    }
  }

  async function handleReloadNginx() {
    setReloadingNginx(true);
    setReloadError(null);
    setReloadResult(null);
    try {
      const result = await reloadNginxRequest();
      setReloadResult(result);
      if (result.reloaded) {
        await refresh();
      }
    } catch (err) {
      setReloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloadingNginx(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[20px] font-semibold tracking-tight text-[#f8f9fa]">
          {meta.title}
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleReloadNginx()}
            disabled={reloadingNginx || !isConnected}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-semibold text-neutral-200 transition hover:bg-white/[0.08] disabled:opacity-50"
            title="sudo nginx -t && sudo systemctl reload nginx"
          >
            {reloadingNginx ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" />
            )}
            Reload nginx
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || !isConnected}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-semibold text-neutral-200 transition hover:bg-white/[0.08] disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
          <ConnectionStatusBadge state={snapshot.state} />
        </div>
      </div>

      {reloadError && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-[13px] text-red-200">
          {reloadError}
        </div>
      )}

      {reloadResult && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-[13px] ${
            reloadResult.reloaded
              ? "border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-200"
              : "border-amber-500/20 bg-amber-500/[0.08] text-amber-100"
          }`}
        >
          <p>{reloadResult.message}</p>
          {!reloadResult.reloaded && (
            <div className="mt-3 flex flex-wrap gap-2">
              <code className="rounded-lg bg-black/20 px-2 py-1 text-[11px]">
                {reloadResult.command}
              </code>
              <button
                type="button"
                onClick={() => void handleCopy("nginx-reload", reloadResult.command)}
                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] font-semibold hover:bg-white/[0.06]"
              >
                <Copy className="h-3 w-3" />
                {copied === "nginx-reload" ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => openApplyInTerminal([reloadResult.command])}
                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] font-semibold hover:bg-white/[0.06]"
              >
                <Terminal className="h-3 w-3" />
                Run in terminal
              </button>
            </div>
          )}
        </div>
      )}

      {removeError && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-[13px] text-red-200">
          {removeError}
        </div>
      )}

      {removeResult && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-[13px] ${
            removeResult.removed
              ? "border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-200"
              : "border-amber-500/20 bg-amber-500/[0.08] text-amber-100"
          }`}
        >
          {removeResult.message}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-[13px] text-red-200">
          {error}
        </div>
      )}

      {!isConnected && (
        <div className="mt-4 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center text-[13px] text-neutral-400">
          Waiting for SSH connection…
        </div>
      )}

      {isConnected && overview && (
        <div className="mt-5 space-y-5">
          <CreateProxyPanel
            dnsIp={overview.dnsIp}
            passwordlessSudo={overview.passwordlessSudo}
            portOptions={portOptions}
            unproxiedApps={overview.unproxiedApps}
            submitting={submitting}
            submitError={submitError}
            result={result}
            copied={copied}
            dnsChecking={dnsChecking}
            dnsResult={dnsResult}
            onSubmit={(domain, port, websocketEnabled) =>
              void handleCreate(domain, port, websocketEnabled)
            }
            onCheckDns={() => void handleCheckDns()}
            onCopy={(label, value) => void handleCopy(label, value)}
            onRunInTerminal={openApplyInTerminal}
          />

          <section className={cardClassName()}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
              <p className="text-[13px] font-semibold text-[#f8f9fa]">
                Active proxies ({overview.proxies.length})
              </p>
              {overview.dnsIp && (
                <p className="font-mono text-[11px] text-neutral-500">{overview.dnsIp}</p>
              )}
            </div>

            <div className="px-5 py-4">
              {overview.proxies.length === 0 ? (
                <p className="text-[12px] text-neutral-500">No nginx proxies found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-white/[0.04] text-[9px] font-semibold tracking-wider text-neutral-500 uppercase">
                        <th className="pb-2.5">Domain</th>
                        <th className="pb-2.5">Target</th>
                        <th className="pb-2.5">PM2 App</th>
                        <th className="pb-2.5">Config</th>
                        <th className="pb-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.02] text-[12px]">
                      {overview.proxies.map((proxy: NginxProxyEntry) => {
                        const protectedDomain = isProtectedDomain(proxy.domain);
                        return (
                          <tr key={proxy.domain} className="hover:bg-white/[0.01]">
                            <td className="py-3 pr-2 font-semibold text-white">
                              {proxy.domain}
                            </td>
                            <td className="py-3 pr-2 font-mono text-neutral-300">
                              {proxy.targetHost}:{proxy.targetPort}
                            </td>
                            <td className="py-3 pr-2 text-neutral-400">
                              {proxy.pm2App ?? "—"}
                            </td>
                            <td className="py-3 pr-2 font-mono text-[10px] text-neutral-500">
                              {proxy.configFile.replace("/etc/nginx/sites-enabled/", "")}
                            </td>
                            <td className="py-3 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => void openUrl(`http://${proxy.domain}`)}
                                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-white/[0.04]"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Open
                                </button>
                                {!protectedDomain && (
                                  <button
                                    type="button"
                                    onClick={() => void handleRemove(proxy.domain)}
                                    disabled={removingDomain === proxy.domain}
                                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                                  >
                                    {removingDomain === proxy.domain ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                    Remove
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {overview.unproxiedApps.length > 0 && (
            <section className={cardClassName()}>
              <div className="border-b border-white/[0.06] px-5 py-3">
                <p className="text-[13px] font-semibold text-[#f8f9fa]">
                  Unproxied apps ({overview.unproxiedApps.length})
                </p>
              </div>
              <div className="space-y-2 px-5 py-4">
                {overview.unproxiedApps.map((app) => (
                  <div
                    key={`${app.name}-${app.port}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-white">{app.name}</p>
                      <p className="text-[11px] text-neutral-500">Port {app.port}</p>
                    </div>
                    <Server className="h-4 w-4 text-neutral-600" />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
