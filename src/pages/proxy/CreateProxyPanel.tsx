import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Copy,
  Globe,
  Loader2,
  Lock,
  Plus,
  Server,
  Terminal,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { CreateProxyResult, UnproxiedPm2App } from "../../types/proxy";
import {
  PROXY_BASE_DOMAIN,
  buildFullDomain,
  cloudflareRecordName,
  executableApplyCommands,
  normalizeSubdomain,
  suggestSubdomainFromAppName,
  validateSubdomain,
} from "./proxy-domain";

type PortOption = { port: number; label: string };

type CreateProxyPanelProps = {
  dnsIp: string;
  passwordlessSudo: boolean;
  portOptions: PortOption[];
  unproxiedApps: UnproxiedPm2App[];
  submitting: boolean;
  submitError: string | null;
  result: CreateProxyResult | null;
  copied: string | null;
  dnsChecking: boolean;
  dnsResult: string | null;
  onSubmit: (domain: string, port: number, websocketEnabled: boolean) => void;
  onCheckDns: () => void;
  onCopy: (label: string, value: string) => void;
  onRunInTerminal: (commands: string[]) => void;
};

function StepBadge({
  step,
  label,
  active,
  done,
}: {
  step: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={[
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold tracking-wide uppercase transition",
        done
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : active
            ? "border-white/20 bg-white/[0.08] text-white"
            : "border-white/[0.06] bg-white/[0.02] text-neutral-500",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-4 w-4 items-center justify-center rounded-full text-[9px]",
          done
            ? "bg-emerald-500/20 text-emerald-300"
            : active
              ? "bg-white/15 text-white"
              : "bg-white/[0.06] text-neutral-500",
        ].join(" ")}
      >
        {done ? "✓" : step}
      </span>
      {label}
    </div>
  );
}

export function CreateProxyPanel({
  dnsIp,
  passwordlessSudo,
  portOptions,
  unproxiedApps,
  submitting,
  submitError,
  result,
  copied,
  dnsChecking,
  dnsResult,
  onSubmit,
  onCheckDns,
  onCopy,
  onRunInTerminal,
}: CreateProxyPanelProps) {
  const [subdomain, setSubdomain] = useState("");
  const [port, setPort] = useState("");
  const [websocketEnabled, setWebsocketEnabled] = useState(true);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);

  const fullDomain = useMemo(() => buildFullDomain(subdomain), [subdomain]);
  const slug = normalizeSubdomain(subdomain);
  const slugError = slug ? validateSubdomain(subdomain) : null;
  const cfRecordName = cloudflareRecordName(fullDomain);
  const parsedPort = Number(port);
  const portValid = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;

  function prefillFromApp(app: UnproxiedPm2App) {
    setSelectedApp(app.name);
    setPort(String(app.port));
    if (!subdomain.trim()) {
      setSubdomain(suggestSubdomainFromAppName(app.name));
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validateSubdomain(subdomain);
    if (validationError) return;
    if (!portValid) return;
    onSubmit(fullDomain, parsedPort, websocketEnabled);
  }

  const stepDone = {
    configure: Boolean(result),
    dns: Boolean(result?.dns),
    apply: Boolean(result?.applied),
  };

  const previewBlock = useMemo(() => {
    if (!slug || !portValid) return null;
    const ws = websocketEnabled
      ? "        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection \"upgrade\";\n"
      : "";
    return `server {
    listen 80;
    server_name ${fullDomain};

    location / {
        proxy_pass http://127.0.0.1:${parsedPort};
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
${ws}    }
}`;
  }, [slug, fullDomain, parsedPort, portValid, websocketEnabled]);

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1c1c1e]/80 shadow-[0_8px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="border-b border-white/[0.06] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-white">
              New proxy · {PROXY_BASE_DOMAIN}
            </h3>
          </div>

          <div
            className={[
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold",
              passwordlessSudo
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/25 bg-amber-500/10 text-amber-200",
            ].join(" ")}
          >
            {passwordlessSudo ? (
              <Zap className="h-3.5 w-3.5" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            {passwordlessSudo ? "Auto-apply" : "Manual sudo"}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <StepBadge step={1} label="Configure" active={!result} done={stepDone.configure} />
          <StepBadge step={2} label="Nginx block" active={Boolean(result) && !result?.applied} done={stepDone.configure} />
          <StepBadge step={3} label="Apply & reload" active={Boolean(result) && !result?.applied} done={stepDone.apply} />
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <form className="space-y-5 border-b border-white/[0.06] px-5 py-5 lg:border-b-0 lg:border-r" onSubmit={handleSubmit}>
          <div>
            <label className="block">
              <span className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                Subdomain
              </span>
              <div className="mt-2 flex overflow-hidden rounded-xl border border-white/[0.1] bg-[#0c0c0d] ring-1 ring-white/[0.04] focus-within:border-sky-500/40 focus-within:ring-sky-500/20">
                <input
                  value={subdomain}
                  onChange={(event) => {
                    setSubdomain(normalizeSubdomain(event.target.value));
                    setSelectedApp(null);
                  }}
                  placeholder="crm"
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[14px] font-medium text-white outline-none"
                />
                <div className="flex items-center border-l border-white/[0.08] bg-white/[0.03] px-3 text-[13px] font-medium text-neutral-400">
                  .{PROXY_BASE_DOMAIN}
                </div>
              </div>
            </label>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 font-mono text-[12px] text-sky-300">
                {slug ? fullDomain : `your-name.${PROXY_BASE_DOMAIN}`}
              </span>
              {slugError && slug && (
                <span className="text-[11px] text-red-300">{slugError}</span>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                Backend port
              </span>
              {portValid && (
                <span className="font-mono text-[11px] text-neutral-500">
                  127.0.0.1:{parsedPort}
                </span>
              )}
            </div>

            {unproxiedApps.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {unproxiedApps.slice(0, 6).map((app) => {
                  const active = selectedApp === app.name && port === String(app.port);
                  return (
                    <button
                      key={`${app.name}-${app.port}`}
                      type="button"
                      onClick={() => prefillFromApp(app)}
                      className={[
                        "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition",
                        active
                          ? "border-sky-500/40 bg-sky-500/10 text-white"
                          : "border-white/[0.08] bg-white/[0.03] text-neutral-300 hover:border-white/[0.14] hover:bg-white/[0.06]",
                      ].join(" ")}
                    >
                      <Server className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                      <span>
                        <span className="block text-[12px] font-semibold">{app.name}</span>
                        <span className="block font-mono text-[10px] text-neutral-500">
                          :{app.port}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <input
              list="proxy-port-options"
              value={port}
              onChange={(event) => {
                setPort(event.target.value);
                setSelectedApp(null);
              }}
              placeholder="4000"
              className="mt-2 w-full rounded-xl border border-white/[0.08] bg-[#0c0c0d] px-3 py-2.5 font-mono text-[13px] text-white outline-none focus:border-white/[0.16]"
            />
            <datalist id="proxy-port-options">
              {portOptions.map((option) => (
                <option key={option.port} value={option.port}>
                  {option.label}
                </option>
              ))}
            </datalist>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold text-white">WebSocket support</p>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                Adds Upgrade / Connection headers for realtime apps
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={websocketEnabled}
              onClick={() => setWebsocketEnabled((value) => !value)}
              className={[
                "relative h-7 w-12 shrink-0 rounded-full transition",
                websocketEnabled ? "bg-sky-500/80" : "bg-white/10",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition",
                  websocketEnabled ? "left-[22px]" : "left-0.5",
                ].join(" ")}
              />
            </button>
          </label>

          {submitError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/[0.08] px-3 py-2.5 text-[12px] text-red-200">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || Boolean(slugError) || !slug || !portValid}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-white to-neutral-200 px-4 py-3 text-[13px] font-semibold text-black transition hover:from-neutral-100 hover:to-white disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Stage proxy for {slug ? fullDomain : "subdomain"}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <div className="space-y-4 px-5 py-5">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0d]/70 p-4">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-sky-300" />
              <p className="text-[12px] font-semibold text-white">Cloudflare DNS preview</p>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
              Point your subdomain to the server before or right after applying nginx — same flow
              as your existing apps on this machine.
            </p>

            <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.06]">
              <div className="grid grid-cols-[72px_1fr] gap-px bg-white/[0.06] text-[11px]">
                {[
                  ["Type", "A"],
                  ["Name", slug ? cfRecordName : "crm"],
                  ["IPv4", dnsIp || "—"],
                  ["Proxy", "DNS only (grey cloud)"],
                ].map(([label, value]) => (
                  <div key={label} className="contents">
                    <div className="bg-[#111113] px-3 py-2.5 font-semibold text-neutral-500">
                      {label}
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-[#111113] px-3 py-2.5 font-mono text-neutral-200">
                      <span className="truncate">{value}</span>
                      {label === "IPv4" && dnsIp && (
                        <button
                          type="button"
                          onClick={() => void onCopy("dns-ip", dnsIp)}
                          className="shrink-0 rounded-md border border-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-neutral-300 hover:bg-white/[0.06]"
                        >
                          {copied === "dns-ip" ? "Copied" : "Copy"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-3 text-[11px] text-neutral-500">
              Full URL after DNS propagates:{" "}
              <span className="font-mono text-neutral-300">
                http://{slug ? fullDomain : `subdomain.${PROXY_BASE_DOMAIN}`}
              </span>
            </p>
          </div>

          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-[12px] text-neutral-500">
            A record → grey cloud → append to sites-available/app → reload nginx
          </div>

          {previewBlock && (
            <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0d]/70 p-4">
              <p className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                Block preview (appended to app config)
              </p>
              <pre className="mt-2 overflow-x-auto rounded-xl border border-white/[0.06] bg-black/30 p-3 text-[10px] leading-relaxed text-neutral-300">
                {previewBlock}
              </pre>
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="border-t border-white/[0.06] bg-black/20 px-5 py-5">
          <div className="flex items-start gap-3">
            {result.applied ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-white">
                {result.applied ? "Proxy live on nginx" : "Block staged on server — apply with sudo"}
              </p>
              <p className="mt-1 text-[12px] text-neutral-400">{result.message}</p>
              <p className="mt-2 font-mono text-[11px] text-neutral-500">
                Staged: {result.stagedPath} → {result.targetConfigFile}
              </p>

              <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Server block
                </p>
                <pre className="mt-2 overflow-x-auto text-[10px] leading-relaxed text-neutral-300">
                  {result.configContent}
                </pre>
              </div>

              {!result.portListening && (
                <p className="mt-2 text-[12px] text-amber-300">
                  Nothing is listening on port {result.port} yet — start the PM2 app first.
                </p>
              )}

              {!result.applied && (
                <div className="mt-4 space-y-3">
                  <p className="text-[12px] text-neutral-400">
                    The Server terminal opens automatically after staging. Enter your sudo
                    password once — backup, append, test, and reload run in a single step.
                  </p>
                  <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0c0c0d] p-4 text-[11px] leading-relaxed text-neutral-200">
                    {executableApplyCommands(result.applyCommands).join("\n")}
                  </pre>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void onCopy(
                          "commands",
                          executableApplyCommands(result.applyCommands).join("\n"),
                        )
                      }
                      className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-neutral-200 hover:bg-white/[0.08]"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied === "commands" ? "Copied" : "Copy commands"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRunInTerminal(result.applyCommands)}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-neutral-200 hover:bg-white/[0.08]"
                    >
                      <Terminal className="h-3.5 w-3.5" />
                      Re-open apply terminal
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void onCheckDns()}
                  disabled={dnsChecking}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-neutral-200 hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {dnsChecking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Globe className="h-3.5 w-3.5" />
                  )}
                  Verify DNS for {result.dns.name}
                </button>
                <button
                  type="button"
                  onClick={() => void onCopy("certbot", result.dns.certbotCommand)}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-neutral-200 hover:bg-white/[0.08]"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied === "certbot" ? "Copied" : "Copy certbot command"}
                </button>
              </div>

              {dnsResult && <p className="mt-3 text-[12px] text-neutral-300">{dnsResult}</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
