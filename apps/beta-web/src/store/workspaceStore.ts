import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserRole } from "../lib/types";

interface WorkspaceState {
  userRole: UserRole;
  profileName: string;
  profileEmail: string;
  workspaceName: string;
  activeProjectId: string | null;
  onboardingComplete: boolean;
  setUserRole: (role: UserRole) => void;
  setProfile: (name: string, email: string) => void;
  setWorkspaceName: (name: string) => void;
  setActiveProject: (id: string, name: string) => void;
  clearActiveProject: () => void;
  setOnboardingComplete: (value: boolean) => void;
  resetWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      userRole: "developer",
      profileName: "",
      profileEmail: "",
      workspaceName: "",
      activeProjectId: null,
      onboardingComplete: false,
      setUserRole: (role) => set({ userRole: role }),
      setProfile: (name, email) => set({ profileName: name, profileEmail: email }),
      setWorkspaceName: (name) => set({ workspaceName: name }),
      setActiveProject: (id, name) => set({ activeProjectId: id, workspaceName: name, onboardingComplete: true }),
      clearActiveProject: () => set({ activeProjectId: null, workspaceName: "", onboardingComplete: false }),
      setOnboardingComplete: (value) => set({ onboardingComplete: value }),
      resetWorkspace: () =>
        set({
          userRole: "developer",
          profileName: "",
          profileEmail: "",
          workspaceName: "",
          activeProjectId: null,
          onboardingComplete: false
        })
    }),
    { name: "orchestra_workspace" }
  )
);
