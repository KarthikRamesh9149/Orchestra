import { useNavigate } from "react-router-dom";
import { SocratesLogo } from "../components/ui/SocratesLogo";
import { useAuth } from "../context/AuthContext";

export function ClientWorkspacePage() {
  const navigate = useNavigate();
  const { activeProject, user, signOut } = useAuth();

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
      <section className="w-full max-w-[680px] rounded-[24px] border border-[rgba(26,22,18,0.08)] bg-white p-8 shadow-[0_18px_60px_rgba(26,22,18,0.06)]">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F7F3EC]">
          <SocratesLogo size={20} className="text-[#1A1612]" />
        </div>
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-[#B8543D]">Client access</p>
        <h1 className="mt-2 font-sans text-[30px] font-medium text-[#1A1612]">{activeProject?.name}</h1>
        <p className="mt-3 font-sans text-[14px] leading-6 text-[#6F6862]">
          You have client access to this workspace. Internal dashboards, project memory, team settings and Socrates are intentionally unavailable to client members.
        </p>
        <p className="mt-3 font-sans text-[13px] leading-6 text-[#78716C]">
          Ask a workspace manager for a client-portal share link to view approved material. Signed in as {user?.email}.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => navigate("/workspaces")} className="rounded-xl bg-[#1A1612] px-5 py-3 font-sans text-[13px] text-white">
            Choose another workspace
          </button>
          <button type="button" onClick={() => void signOut()} className="rounded-xl border border-[rgba(26,22,18,0.1)] px-5 py-3 font-sans text-[13px] text-[#5A5450]">
            Log out
          </button>
        </div>
      </section>
    </main>
  );
}
