import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MemoryTimelinePage } from "./MemoryTimelinePage";

vi.mock("./MemoryPage", () => ({ MemoryPage: () => <div>Memory panel</div> }));
vi.mock("./TimelinePage", () => ({ TimelinePage: () => <div>Timeline panel</div> }));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

describe("[FIX-21] stable Timeline route", () => {
  it("loads Timeline directly and preserves its deep-link query across panel navigation", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/timeline?source=github&event=commit-1"]}>
        <MemoryTimelinePage />
        <LocationProbe />
      </MemoryRouter>
    );

    expect(screen.getByText("Timeline panel")).toBeVisible();
    expect(screen.getByRole("tab", { name: "timeline" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "memory" }));
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/memory?source=github&event=commit-1");
    expect(screen.getByRole("tab", { name: "memory" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "timeline" }));
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/timeline?source=github&event=commit-1");
  });
});
