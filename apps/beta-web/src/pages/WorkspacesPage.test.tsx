import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacesPage } from "./WorkspacesPage";

const auth = vi.hoisted(() => ({
  selectProject: vi.fn(),
  refreshProjects: vi.fn(),
  createWorkspace: vi.fn(),
  signOut: vi.fn(),
  user: { id: "user-1", orgId: "org-1", email: "manager@example.com", globalRole: "owner" },
  projects: [
    { id: "project-1", name: "Fast Workspace", organizationId: "org-1", projectRole: "manager" },
  ]
}));

vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../lib/performance/prefetch", () => ({ prefetchPrimaryRoute: vi.fn(async () => undefined) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/workspaces"]}>
      <Routes>
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/memory" element={<p>Memory opened</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("WorkspacesPage performance", () => {
  beforeEach(() => {
    auth.selectProject.mockReset();
    auth.refreshProjects.mockReset();
    auth.createWorkspace.mockReset();
    auth.signOut.mockReset();
    auth.user.orgId = "org-1";
    auth.projects[0].organizationId = "org-1";
  });

  it("opens a workspace in the active organization before persistence finishes", async () => {
    const selection = deferred<(typeof auth.projects)[number]>();
    auth.selectProject.mockReturnValue(selection.promise);
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Fast Workspace/ }));

    expect(auth.selectProject).toHaveBeenCalledWith("project-1", { optimistic: true });
    expect(screen.getByText("Memory opened")).toBeInTheDocument();
    selection.resolve(auth.projects[0]);
  });

  it('shows a failed sign-out without abandoning the workspace chooser',async()=>{
    auth.signOut.mockRejectedValue(new Error('Sign-out was not confirmed'));
    renderPage();
    await userEvent.click(screen.getByRole('button',{name:'Log out'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-out was not confirmed');
    expect(screen.getByRole('heading',{name:'Choose a workspace'})).toBeInTheDocument();
  });

  it("waits for server confirmation when switching organizations", async () => {
    const selection = deferred<(typeof auth.projects)[number]>();
    auth.projects[0].organizationId = "org-2";
    auth.selectProject.mockReturnValue(selection.promise);
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Fast Workspace/ }));
    expect(auth.selectProject).toHaveBeenCalledWith("project-1", { optimistic: false });
    expect(screen.queryByText("Memory opened")).not.toBeInTheDocument();

    selection.resolve(auth.projects[0]);
    await screen.findByText("Memory opened");
  });

  it("returns to the chooser and reports a rejected optimistic switch", async () => {
    const selection = deferred<(typeof auth.projects)[number]>();
    auth.selectProject.mockReturnValue(selection.promise);
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Fast Workspace/ }));
    expect(screen.getByText("Memory opened")).toBeInTheDocument();
    selection.reject(new Error("Workspace access is no longer available."));

    await waitFor(() => expect(screen.getByText("Workspace access is no longer available.")).toBeInTheDocument());
  });
});
