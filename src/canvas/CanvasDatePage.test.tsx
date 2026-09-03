import { render, screen, within } from "@testing-library/react";
import { CanvasDatePage } from "./CanvasDatePage";

describe("CanvasDatePage labels", () => {
  it("keeps time-fence labels readable when the canvas is zoomed out", () => {
    render(<CanvasDatePage ariaLabel="今天的画布" zoom={0.37} />);

    const label = within(screen.getByRole("group", { name: "上午" })).getByText("上午");
    expect(label.parentElement).toHaveStyle({
      transform: "scale(2.7027027027027026)",
      transformOrigin: "top left",
    });
  });
});
