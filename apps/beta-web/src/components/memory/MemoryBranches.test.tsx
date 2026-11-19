import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "../../lib/types";
import { MemoryBranches } from "./MemoryBranches";

const api = vi.hoisted(() => ({
  getTruthInbox: vi.fn(),
  getTruthChangePacket: vi.fn(),
  getDocViewer: vi.fn(),
}));
vi.mock("../../lib/api/truthInbox", () => api);
vi.mock("../../lib/api/documents", () => api);
const doc = (id: string, name: string): Doc => ({
  id,
  name,
  type: "spec",
  size: "1 KB",
  pages: 1,
  status: "ready",
  uploadedBy: "Owner",
  uploadedAt: "",
  excerpt: "",
});
const docs = [doc("a", "Pilot brief"), doc("b", "Test plan")];
const page = (documents: Doc[] = docs) =>
  render(
    <MemoryRouter>
      <MemoryBranches
        projectId="p"
        projectName="Desktop pilot"
        documents={documents}
        threads={[]}
        loading={false}
        onSources={vi.fn()}
      />
    </MemoryRouter>,
  );
const viewer = (text: string) => ({
  version: { id: "version-2" },
  sections: [
    {
      sectionId: "s",
      anchorId: "acceptance",
      headingPath: ["Release criteria"],
      text,
    },
  ],
});

describe("Project Memory branches", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getTruthInbox.mockResolvedValue({
      items: [],
      page: { hasMore: false },
    });
  });

  it("reads only the selected source and opens its exact version and passage", async () => {
    api.getDocViewer.mockResolvedValue(viewer("Two reviewers are required."));
    page();
    expect(
      await screen.findByText("Two reviewers are required."),
    ).toBeVisible();
    expect(api.getDocViewer).toHaveBeenCalledTimes(1);
    expect(api.getDocViewer).toHaveBeenCalledWith(
      "p",
      "a",
      undefined,
      expect.any(AbortSignal),
    );
    expect(screen.getByRole("link", { name: "Open passage" })).toHaveAttribute(
      "href",
      "/memory/docs/a/view?versionId=version-2#acceptance",
    );
    await userEvent.type(screen.getByRole("textbox"), "nothing matches");
    expect(
      screen.getByText("No matching branches in this view."),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Open passage" }),
    ).not.toBeInTheDocument();
  });

  it("ignores a late response for a previously selected branch", async () => {
    let finish!: (value: ReturnType<typeof viewer>) => void;
    api.getDocViewer.mockImplementation((_project: string, id: string) =>
      id === "a"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(viewer("Current test plan.")),
    );
    page();
    await userEvent.click(screen.getByRole("button", { name: /Test plan/ }));
    expect(await screen.findByText("Current test plan.")).toBeVisible();
    await act(async () => {
      finish(viewer("Old selection."));
    });
    expect(screen.queryByText("Old selection.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open passage" })).toHaveAttribute(
      "href",
      "/memory/docs/b/view?versionId=version-2#acceptance",
    );
  });

  it("keeps an empty or unavailable source distinct from an accepted decision and permits retry", async () => {
    api.getDocViewer
      .mockRejectedValueOnce(new Error("Source unavailable"))
      .mockResolvedValue({ sections: [] });
    page();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Source unavailable",
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        screen.getByText("No linked passages are available."),
      ).toBeVisible(),
    );
    expect(screen.queryByText("Recorded decision")).not.toBeInTheDocument();
  });

  it("shows approved requirement wording without calling it a decision record", async () => {
    api.getTruthInbox.mockResolvedValue({items:[{id:"proposal:x", title:"Reviewer count", description:"Review", status:"resolved"}],page:{hasMore:false}});
    api.getTruthChangePacket.mockResolvedValue({item:{comparison:{acceptedWording:"Three reviewers"}},newEvidence:[],
      affected:{productAreas:[]},currentAcceptedTruth:[]});
    page([]);
    expect(await screen.findByText("Three reviewers")).toBeVisible();
    expect(screen.getByText("Accepted change")).toBeVisible();
    expect(screen.queryByText("Recorded decision")).not.toBeInTheDocument();
  });
  it("labels only the recorded decision, not proposed wording or a generated summary", async () => {
    api.getTruthInbox.mockResolvedValue({
      items: [
        {
          id: "proposal:x",
          title: "Reviewer count",
          description: "Review",
          status: "resolved",
        },
      ],
      page: { hasMore: false },
    });
    api.getTruthChangePacket.mockResolvedValue({
      newEvidence: [],
      affected: { productAreas: [] },
      currentAcceptedTruth: [
        { type: "brain_node", detail: "Unverified summary" },
        { type: "accepted_decision", detail: "Reviewed by three people." },
      ],
    });
    page([]);
    expect(await screen.findByText("Reviewed by three people.")).toBeVisible();
    expect(screen.getByText("Recorded decision")).toBeVisible();
    expect(screen.queryByText("Unverified summary")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open change packet/ }),
    ).toHaveAttribute("href", "/truth-inbox/proposal%3Ax");
    expect(api.getTruthChangePacket).toHaveBeenCalledTimes(1);
  });
});
