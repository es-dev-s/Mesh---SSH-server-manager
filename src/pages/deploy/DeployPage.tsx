import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Rocket,
  Server,
  Terminal,
  Trash2,
  Download,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadStoreValue, saveStoreValue, STORE_KEYS } from "../../lib/persistence";
import { ConnectionStatusBadge } from "../dashboard/ConnectionStatusBadge";
import { useSshStore } from "../../hooks/useSshMonitor";
import { useNavigationStore } from "../../stores/useNavigationStore";
import { useServerTabsStore } from "../../stores/useServerTabsStore";
import type { DeployResult } from "../../types/deploy";
import { getPageMeta } from "../page-config";
import {
  pullDeployRequest,
  readDeployEnvRequest,
  removeDeploymentRequest,
  runDeployRequest,
  useDeployOverview,
} from "./useDeployOverview";
import {
  EnvVarEditor,
  parseEnvContent,
  serializeEnvRows,
  type EnvVarRow,
} from "./EnvVarEditor";

function cardClassName() {
  return "overflow-hidden rounded-2xl border border-white/[0.06] bg-[#1c1c1e]/60 shadow-[0_4px_24px_rgba(0,0,0,0.15)] backdrop-blur-md";
}

export function DeployPage() {
  const meta = getPageMeta("deploy");
  const snapshot = useSshStore((state) => state.snapshot);
  const setPage = useNavigationStore((state) => state.setPage);
  const addTab = useServerTabsStore((state) => state.addTab);
  const { overview, loading, error, refresh, isConnected } = useDeployOverview();

  const [repoUrl, setRepoUrl] = useState("");
  const [appName, setAppName] = useState("");
  const [buildCommand, setBuildCommand] = useState("");
  const [startCommand, setStartCommand] = useState("");
  const [envRows, setEnvRows] = useState<EnvVarRow[]>([
    { id: crypto.randomUUID(), key: "DATABASE_URL", value: "" },
    { id: crypto.randomUUID(), key: "JWT_SECRET", value: "" },
    { id: crypto.randomUUID(), key: "PORT", value: "8080" },
  ]);
  const formHydrated = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [pullingApp, setPullingApp] = useState<string | null>(null);
  const [removingApp, setRemovingApp] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadStoreValue<{
      repoUrl?: string;
      appName?: string;
      buildCommand?: string;
      startCommand?: string;
      envRows?: EnvVarRow[];
    }>(STORE_KEYS.deployForm).then((saved) => {
      if (cancelled || !saved) {
        formHydrated.current = true;
        return;
      }
      if (saved.repoUrl) setRepoUrl(saved.repoUrl);
      if (saved.appName) setAppName(saved.appName);
      if (saved.buildCommand) setBuildCommand(saved.buildCommand);
      if (saved.startCommand) setStartCommand(saved.startCommand);
      if (saved.envRows?.length) setEnvRows(saved.envRows);
      formHydrated.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!formHydrated.current) return;
    const timer = window.setTimeout(() => {
      void saveStoreValue(STORE_KEYS.deployForm, {
        repoUrl,
        appName,
        buildCommand,
        startCommand,
        envRows,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [repoUrl, appName, buildCommand, startCommand, envRows]);

  async function loadDeploymentEnv(name: string) {
    try {
      const content = await readDeployEnvRequest(name);
      if (content.trim()) {
        setEnvRows(parseEnvContent(content));
      }
      setAppName(name);
    } catch {
      setAppName(name);
    }
  }

  async function handleDeploy(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setResult(null);

    if (!repoUrl.trim()) {
      setSubmitError("Enter a GitHub repository URL.");
      return;
    }

    setSubmitting(true);
    try {
      const deployed = await runDeployRequest({
        repoUrl: repoUrl.trim(),
        buildCommand: buildCommand.trim() || undefined,
        startCommand: startCommand.trim(),
        appName: appName.trim() || undefined,
        envContent: serializeEnvRows(envRows) || undefined,
      });
      setResult(deployed);
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePull(appName: string) {
    setActionError(null);
    setResult(null);
    setPullingApp(appName);
    try {
      const pulled = await pullDeployRequest(appName);
      setResult(pulled);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPullingApp(null);
    }
  }

  async function handleRemove(appName: string) {
    if (
      !window.confirm(
        `Remove deployment "${appName}"? This stops PM2 and deletes ~/mesh-deployments/${appName}.`,
      )
    ) {
      return;
    }

    setActionError(null);
    setRemovingApp(appName);
    try {
      await removeDeploymentRequest(appName);
      if (result?.appName === appName) {
        setResult(null);
      }
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingApp(null);
    }
  }

  function openPm2Logs(name: string) {
    setPage("server");
    addTab({
      type: "terminal",
      id: `deploy-logs-${name}-${Date.now()}`,
      title: `PM2 ${name}`,
      startupCommand: `pm2 logs '${name.replace(/'/g, `'\\''`)}' --lines 80\n`,
    });
  }

  function goToProxy(subdomain: string) {
    setPage("proxy");
    void subdomain;
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
            onClick={() => void refresh()}
            disabled={loading || !isConnected}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-semibold text-neutral-200 hover:bg-white/[0.08] disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
          <ConnectionStatusBadge state={snapshot.state} />
        </div>
      </div>

      {actionError && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-[13px] text-red-200">
          {actionError}
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

      {isConnected && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <section className={cardClassName()}>
            <div className="border-b border-white/[0.06] px-5 py-3">
              <p className="text-[13px] font-semibold text-white">Deploy from GitHub</p>
            </div>

            <form className="space-y-4 px-5 py-5" onSubmit={(e) => void handleDeploy(e)}>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  GitHub repository
                </span>
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/my-app.git"
                  className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-[#0c0c0d] px-3 py-2.5 text-[13px] text-white outline-none focus:border-white/[0.16]"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    App name (optional)
                  </span>
                  <input
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    placeholder="my-app"
                    className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-[#0c0c0d] px-3 py-2.5 text-[13px] text-white outline-none focus:border-white/[0.16]"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    Build command (optional)
                  </span>
                  <input
                    value={buildCommand}
                    onChange={(e) => setBuildCommand(e.target.value)}
                    placeholder="go build -o travio ."
                    className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-[#0c0c0d] px-3 py-2.5 font-mono text-[12px] text-white outline-none focus:border-white/[0.16]"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Start / run command (optional)
                </span>
                <input
                  value={startCommand}
                  onChange={(e) => setStartCommand(e.target.value)}
                  placeholder="./travio"
                  className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-[#0c0c0d] px-3 py-2.5 font-mono text-[12px] text-white outline-none focus:border-white/[0.16]"
                />
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    Environment variables
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    Saved with this deployment on the server
                  </span>
                </div>
                <EnvVarEditor rows={envRows} onChange={setEnvRows} />
                <p className="mt-2 text-[11px] text-neutral-500">
                  Required for apps like Travio (DATABASE_URL, JWT_SECRET, PORT). Stored as{" "}
                  <span className="font-mono">.env</span> and restored on pull/redeploy.
                </p>
              </div>

              {submitError && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-200">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13px] font-semibold text-black hover:bg-neutral-200 disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4" />
                )}
                Deploy to server
              </button>
            </form>

            {result && (
              <div className="border-t border-white/[0.06] px-5 py-5">
                <div className="flex items-start gap-2">
                  {result.success ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" />
                  ) : (
                    <XCircle className="mt-0.5 h-5 w-5 text-red-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-white">{result.message}</p>
                    {result.localUrl && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="rounded-lg bg-black/30 px-2 py-1 font-mono text-[12px] text-sky-300">
                          {result.localUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => void openUrl(result.localUrl!)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300 hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => goToProxy(result.appName)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-300 hover:underline"
                        >
                          <Globe className="h-3.5 w-3.5" />
                          Add domain in Proxy
                        </button>
                      </div>
                    )}
                    <ul className="mt-3 space-y-1.5">
                      {result.steps.map((step) => (
                        <li
                          key={`${step.label}-${step.detail}`}
                          className="flex items-start gap-2 text-[12px]"
                        >
                          {step.success ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                          ) : (
                            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                          )}
                          <span className="text-neutral-300">
                            <span className="font-semibold text-white">{step.label}</span> —{" "}
                            {step.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => openPm2Logs(result.pm2Name)}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] font-semibold text-neutral-200 hover:bg-white/[0.06]"
                    >
                      <Terminal className="h-3.5 w-3.5" />
                      View PM2 logs
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <div className="space-y-6">
            <section className={cardClassName()}>
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-4">
                <BookOpen className="h-4 w-4 text-neutral-400" />
                <p className="text-[13px] font-semibold text-white">PM2 deploy guide</p>
              </div>
              <div className="space-y-4 px-5 py-4 text-[12px] leading-relaxed text-neutral-400">
                <div>
                  <p className="font-semibold text-neutral-200">1. Deploy here</p>
                  <p className="mt-1">
                    Mesh clones to <span className="font-mono text-neutral-300">~/mesh-deployments/</span>,
                    runs your build (if set), and starts the app with PM2 as{" "}
                    <span className="font-mono text-neutral-300">mesh-your-app</span>.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-neutral-200">2. Verify it is live</p>
                  <p className="mt-1">
                    Open the local URL (server IP + detected port). Use Server → PM2 logs if the port
                    is not detected yet.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-neutral-200">3. Manual PM2 (SSH)</p>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 p-3 font-mono text-[10px] text-neutral-300">
{`cd ~/mesh-deployments/my-app
npm install && npm run build
pm2 start npm --name mesh-my-app -- start
pm2 save
pm2 logs mesh-my-app`}
                  </pre>
                </div>
                <div>
                  <p className="font-semibold text-neutral-200">4. Public domain</p>
                  <p className="mt-1">
                    Go to <button type="button" onClick={() => setPage("proxy")} className="font-semibold text-sky-300 hover:underline">Proxy</button> — add a subdomain on salesradar.live, Cloudflare A record, append nginx block.
                  </p>
                </div>
              </div>
            </section>

            <section className={cardClassName()}>
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-4">
                <Server className="h-4 w-4 text-neutral-400" />
                <p className="text-[13px] font-semibold text-white">
                  Deployments {overview ? `(${overview.deployments.length})` : ""}
                </p>
              </div>
              <div className="px-5 py-4">
                {!overview || overview.deployments.length === 0 ? (
                  <p className="text-[12px] text-neutral-500">No deployments yet.</p>
                ) : (
                  <div className="space-y-2">
                    {overview.deployments.map((entry) => (
                      <div
                        key={entry.appName}
                        className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-[13px] font-semibold text-white">{entry.appName}</p>
                            <p className="font-mono text-[10px] text-neutral-500">{entry.pm2Name}</p>
                          </div>
                          <span
                            className={[
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              entry.pm2Status === "online"
                                ? "bg-emerald-500/10 text-emerald-300"
                                : "bg-neutral-500/10 text-neutral-400",
                            ].join(" ")}
                          >
                            {entry.pm2Status ?? "unknown"}
                          </span>
                        </div>
                        {entry.localUrl && (
                          <button
                            type="button"
                            onClick={() => void openUrl(entry.localUrl!)}
                            className="mt-2 font-mono text-[11px] text-sky-300 hover:underline"
                          >
                            {entry.localUrl}
                          </button>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void loadDeploymentEnv(entry.appName)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-semibold text-neutral-200 hover:bg-white/[0.06]"
                          >
                            <BookOpen className="h-3.5 w-3.5" />
                            Load env
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePull(entry.appName)}
                            disabled={pullingApp === entry.appName}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-semibold text-neutral-200 hover:bg-white/[0.06] disabled:opacity-50"
                          >
                            {pullingApp === entry.appName ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            Pull & redeploy
                          </button>
                          <button
                            type="button"
                            onClick={() => openPm2Logs(entry.pm2Name)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-semibold text-neutral-200 hover:bg-white/[0.06]"
                          >
                            <Terminal className="h-3.5 w-3.5" />
                            Logs
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemove(entry.appName)}
                            disabled={removingApp === entry.appName}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                          >
                            {removingApp === entry.appName ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
