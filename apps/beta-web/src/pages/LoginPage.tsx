import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRightIcon } from "../components/ui/AppIcons";
import { SocratesLogo } from "../components/ui/SocratesLogo";
import { useAuth } from "../context/AuthContext";
import { confirmEmailVerification } from "../lib/api";

const cardTransition = {
  duration: 0.4,
  ease: [0.22, 1, 0.36, 1] as const
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { status, signIn, createAccount, joinWorkspace } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "join">("signin");
  const [inviteAccountType, setInviteAccountType] = useState<"existing" | "new">("existing");
  const [displayName, setDisplayName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const inviteStorageKey = `orchestra:invite:${(searchParams.get("email") ?? "unknown").trim().toLowerCase()}`;
  const [inviteToken] = useState(() => new URLSearchParams(location.search).get("invite_token") ?? sessionStorage.getItem(inviteStorageKey) ?? "");
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && !searchParams.get("verify_email") && !inviteToken && searchParams.get("mode") !== "join") {
      navigate("/workspaces", { replace: true });
    }
  }, [inviteToken, navigate, searchParams, status]);

  useEffect(() => {
    const invitedEmail = searchParams.get("email");
    if (searchParams.get("mode") === "join" && invitedEmail) {
      setMode("join");
      setEmail(invitedEmail);
    }
    if (inviteToken && searchParams.get("invite_token")) {
      sessionStorage.setItem(inviteStorageKey, inviteToken);
      const safeQuery = new URLSearchParams({ mode: "join", ...(invitedEmail ? { email: invitedEmail } : {}) });
      window.history.replaceState(window.history.state, "", `/login?${safeQuery.toString()}`);
    }
    const verificationToken = searchParams.get("verify_email");
    if (!verificationToken) return;
    window.history.replaceState(window.history.state, "", "/login");
    let cancelled = false;
    setBusy(true);
    void confirmEmailVerification(verificationToken)
      .then(() => { if (!cancelled) { setVerificationMessage("Email verified. You can now change your password securely."); setSearchParams({}, { replace: true }); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Email verification failed"); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [inviteStorageKey, inviteToken, searchParams, setSearchParams]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await createAccount({
          orgName: orgName.trim(),
          displayName: displayName.trim(),
          email: email.trim(),
          password,
          projectName: projectName.trim()
        });
      } else if (mode === "join") {
        if (inviteAccountType === "new") {
          if (password !== confirmPassword) {
            throw new Error("Passwords do not match");
          }
          await joinWorkspace({
            accountType: "new",
            email: email.trim(),
            ...(inviteToken ? { inviteToken } : { code: inviteCode.trim().toUpperCase() }),
            password,
            displayName: displayName.trim()
          });
        } else {
          await joinWorkspace({
            accountType: "existing",
            email: email.trim(),
            ...(inviteToken ? { inviteToken } : { code: inviteCode.trim().toUpperCase() }),
            password
          });
        }
      } else {
        await signIn({
          email: email.trim(),
          password
        });
      }
      if (mode === "join" && inviteToken) sessionStorage.removeItem(inviteStorageKey);
      navigate("/workspaces", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    email.trim().length > 0 &&
    ((mode === "signin" && password.length >= 8) ||
      (mode === "join" &&
        password.length >= (inviteAccountType === "new" ? 12 : 8) &&
        (Boolean(inviteToken) || /^(?:[A-HJ-NP-Z2-9]{6}|ORCH-[A-Z0-9]{6}-[A-Z0-9]{6})$/i.test(inviteCode.trim())) &&
        (inviteAccountType === "existing" ||
          (displayName.trim().length >= 2 && confirmPassword.length >= 12))) ||
      (mode === "signup" &&
        password.length >= 8 &&
        displayName.trim().length >= 2 &&
        orgName.trim().length >= 2 &&
        projectName.trim().length >= 2));

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={cardTransition}
        className="solid-card w-full max-w-[520px] p-10"
      >
        <div className="text-center">
          <div className="flex justify-center">
            <SocratesLogo size={39} className="text-[var(--text-default)]" />
          </div>
          <h1 className="mt-4 font-sans text-[48px] leading-none text-[var(--text-default)]">OrchestraOS</h1>
          <p className="mt-2 font-sans text-[14px] text-[var(--text-muted)]">Project memory, Socrates, and VS Code.</p>
        </div>

        <div className="mt-10 grid grid-cols-3 rounded-2xl bg-[#FAF8F5] p-1">
          {(["signin", "join", "signup"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => {
                setMode(item);
                setError(null);
              }}
              className={[
                "rounded-xl px-4 py-2.5 font-sans text-[13px] transition-colors",
                mode === item ? "bg-[var(--bg-card)] text-[var(--text-default)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-default)]"
              ].join(" ")}
            >
              {item === "signin" ? "Sign in" : item === "join" ? "Join workspace" : "Create beta workspace"}
            </button>
          ))}
        </div>

        <form onSubmit={(event) => void submit(event)} className="mt-8 space-y-4">
          {mode === "join" ? (
            <div className="grid grid-cols-2 rounded-xl border border-[rgba(26,22,18,0.08)] bg-[#FAF8F5] p-1" aria-label="Invitation account type">
              <button
                type="button"
                aria-pressed={inviteAccountType === "existing"}
                onClick={() => {
                  setInviteAccountType("existing");
                  setError(null);
                }}
                className={inviteAccountType === "existing" ? "rounded-lg bg-[var(--bg-card)] px-3 py-2 text-[13px] text-[var(--text-default)] shadow-sm" : "rounded-lg px-3 py-2 text-[13px] text-[var(--text-muted)]"}
              >
                I have an account
              </button>
              <button
                type="button"
                aria-pressed={inviteAccountType === "new"}
                onClick={() => {
                  setInviteAccountType("new");
                  setError(null);
                }}
                className={inviteAccountType === "new" ? "rounded-lg bg-[var(--bg-card)] px-3 py-2 text-[13px] text-[var(--text-default)] shadow-sm" : "rounded-lg px-3 py-2 text-[13px] text-[var(--text-muted)]"}
              >
                I'm new to Orchestra
              </button>
            </div>
          ) : null}

          {mode === "signup" ? (
            <>
              <Field label="Your name" value={displayName} onChange={setDisplayName} autoComplete="name" />
              <Field label="Organization" value={orgName} onChange={setOrgName} autoComplete="organization" />
              <Field label="Project name" value={projectName} onChange={setProjectName} autoComplete="off" />
            </>
          ) : null}

          {mode === "join" && inviteAccountType === "new" ? (
            <Field label="Your name" value={displayName} onChange={setDisplayName} autoComplete="name" />
          ) : null}

          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          {mode === "join" && !inviteToken ? (
            <Field
              label="Workspace invite code"
              value={inviteCode}
              onChange={(value) => setInviteCode(value.toUpperCase())}
              autoComplete="off"
              placeholder="ABC234"
            />
          ) : mode === "join" ? <p className="rounded-xl bg-[#FAF8F5] px-4 py-3 font-sans text-[13px] text-[var(--text-muted)]">Secure email invitation loaded. Finish account setup below.</p> : null}
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === "signin" || (mode === "join" && inviteAccountType === "existing") ? "current-password" : "new-password"}
          />
          {mode === "join" && inviteAccountType === "new" ? (
            <Field
              label="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
            />
          ) : null}

          {verificationMessage ? <div className="rounded-xl border border-[#2A9D8F]/20 bg-[var(--tint-teal)] px-4 py-3"><p role="status" className="font-sans text-[13px] leading-5 text-[var(--teal-text)]">{verificationMessage}</p></div> : null}
          {error ? (
            <div className="rounded-xl border border-[#9E3B2E]/20 bg-[#9E3B2E]/5 px-4 py-3">
              <p role="alert" className="font-sans text-[13px] leading-5 text-[var(--red-text)]">{error}</p>
            </div>
          ) : null}

          <motion.button
            type="submit"
            disabled={!canSubmit || busy}
            whileHover={canSubmit && !busy ? { scale: 1.01 } : undefined}
            whileTap={canSubmit && !busy ? { scale: 0.98 } : undefined}
            className="flex h-[54px] w-full items-center justify-center gap-3 rounded-2xl bg-[#1A1612] font-sans text-[15px] font-medium text-white transition-colors hover:bg-[#2A241F] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Connecting..." : mode === "signin" ? "Open beta" : mode === "join" ? "Join workspace" : "Create beta"}
            <ArrowRightIcon className="h-[18px] w-[18px]" />
          </motion.button>
        </form>
      </motion.section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  required = true
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-sans text-[12px] text-[var(--text-muted)]">{label}</span>
      <input
        required={required}
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-xl border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] px-3.5 py-2.5 font-sans text-[14px] text-[var(--text-default)] outline-none transition-colors focus:border-[#B8543D]"
      />
    </label>
  );
}
