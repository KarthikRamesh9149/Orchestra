import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OperationalStateNotice } from "./OperationalStateNotice";

describe("OperationalStateNotice", () => {
  it.each([
    ["disconnected", "Disconnected"],
    ["forbidden", "Access unavailable"],
    ["degraded", "Service degraded"],
    ["stale", "Data is stale"],
    ["failed", "Could not load"]
  ] as const)("renders the %s failure honestly", (state, label) => {
    render(
      <OperationalStateNotice
        value={{ state, error: { code: `${state}_code`, message: `${state} details`, status: 500 } }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(label);
    expect(screen.getByRole("alert")).toHaveTextContent(`${state} details`);
    expect(screen.getByRole("alert")).toHaveTextContent(`${state}_code`);
  });

  it("renders an authoritative empty state separately from failure", () => {
    render(<OperationalStateNotice value={{ state: "empty", data: [], receivedAt: "2026-08-20T00:00:00.000Z" }} emptyMessage="No records yet." />);
    expect(screen.getByRole("status")).toHaveTextContent("No records yet.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers a real retry action", async () => {
    const retry = vi.fn();
    render(
      <OperationalStateNotice
        value={{ state: "failed", error: { code: "failed", message: "Failed", status: 500 } }}
        onRetry={retry}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
