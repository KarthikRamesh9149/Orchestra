import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const mocks = vi.hoisted(() => ({ joinWorkspace: vi.fn() }));

function lastJoinWorkspaceButton() {
  const buttons = screen.getAllByRole("button", { name: "Join workspace" });
  return buttons[buttons.length - 1]!;
}

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    status: "anonymous",
    signIn: vi.fn(),
    createAccount: vi.fn(),
    joinWorkspace: mocks.joinWorkspace
  })
}));

describe("invitation account completion", () => {
  beforeEach(() => {
    mocks.joinWorkspace.mockReset();
    mocks.joinWorkspace.mockResolvedValue(undefined);
  });

  it("lets an existing account authenticate before redeeming an invite", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    await user.click(lastJoinWorkspaceButton());
    await waitFor(() => expect(screen.getByRole("button", { name: "I have an account" })).toBeVisible());
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("requires a new invitee to create a profile and password", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    await user.click(lastJoinWorkspaceButton());
    await user.click(screen.getByRole("button", { name: "I'm new to Orchestra" }));

    expect(screen.getByLabelText("Your name")).toBeVisible();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirm password")).toBeVisible();
  });

  it("sends authenticated existing-account redemption data", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    await user.click(screen.getByRole("button", { name: "Join workspace" }));
    await user.type(screen.getByLabelText("Email"), "Invitee@Example.com");
    await user.type(screen.getByLabelText("Workspace invite code"), "abc234");
    await user.type(screen.getByLabelText("Password"), "Password123!");
    await user.click(lastJoinWorkspaceButton());

    expect(mocks.joinWorkspace).toHaveBeenCalledWith({
      accountType: "existing",
      email: "Invitee@Example.com",
      code: "ABC234",
      password: "Password123!"
    });
  });

  it("loads a secure email invitation without exposing its token in the form", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/login?mode=join&email=invitee%40example.com&invite_token=abcdefghijklmnopqrstuvwxyz1234567890"]}><LoginPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Secure email invitation loaded. Finish account setup below.")).toBeVisible());
    expect(screen.queryByLabelText("Workspace invite code")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("invitee@example.com");
    await user.type(screen.getByLabelText("Password"), "Password123!");
    await user.click(lastJoinWorkspaceButton());
    expect(mocks.joinWorkspace).toHaveBeenCalledWith(expect.objectContaining({ inviteToken: "abcdefghijklmnopqrstuvwxyz1234567890", email: "invitee@example.com" }));
  });

  it("blocks new-account redemption when password confirmation differs", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    await user.click(screen.getByRole("button", { name: "Join workspace" }));
    await user.click(screen.getByRole("button", { name: "I'm new to Orchestra" }));
    await user.type(screen.getByLabelText("Your name"), "New Invitee");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Workspace invite code"), "ORCH-ABC123-DEF456");
    await user.type(screen.getByLabelText("Password"), "Password123!");
    await user.type(screen.getByLabelText("Confirm password"), "Password456!");
    await user.click(lastJoinWorkspaceButton());

    expect(await screen.findByText("Passwords do not match")).toBeVisible();
    expect(mocks.joinWorkspace).not.toHaveBeenCalled();
  });

  it("allows first-time invitees to create their own password from an email link", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/login?mode=join&email=new%40example.com&invite_token=synthetic-invitation-token-123456789"]}><LoginPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "I'm new to Orchestra" }));
    await user.type(screen.getByLabelText("Your name"), "New Invitee");
    await user.type(screen.getByLabelText("Password"), "Unique-password-123!");
    await user.type(screen.getByLabelText("Confirm password"), "Unique-password-123!");
    await user.click(lastJoinWorkspaceButton());
    expect(mocks.joinWorkspace).toHaveBeenCalledWith(expect.objectContaining({ accountType: "new", displayName: "New Invitee", inviteToken: "synthetic-invitation-token-123456789" }));
  });
});
