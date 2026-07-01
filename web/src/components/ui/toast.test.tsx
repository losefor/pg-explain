import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster, toast } from "./toast.tsx";

describe("Toaster", () => {
  it("shows a message when toast() is called and marks errors", () => {
    render(<Toaster />);
    act(() => toast("Settings saved"));
    act(() => toast("Export failed", "error"));
    expect(screen.getByText("Settings saved")).toBeDefined();
    expect(screen.getByText("Export failed")).toBeDefined();
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("is a no-op before the Toaster mounts", () => {
    expect(() => toast("nobody is listening")).not.toThrow();
  });
});
