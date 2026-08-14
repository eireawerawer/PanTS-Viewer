import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import LiveRoomCreateDialog from "./LiveRoomCreateDialog";

function LocationProbe() {
	return <output aria-label="Current route">{useLocation().pathname}</output>;
}

function renderDialog(caseId = "35") {
	return render(
		<MemoryRouter initialEntries={[`/case/${caseId}`]}>
			<LiveRoomCreateDialog caseId={caseId} open onClose={vi.fn()} />
			<LocationProbe />
		</MemoryRouter>,
	);
}

describe("Live Room mode menu", () => {
	it("offers the curated Case 35 solo challenge and Individual Race", () => {
		renderDialog();

		const solo = screen.getByRole("button", { name: /Solo Challenge/i });
		expect(solo).toBeEnabled();
		const race = screen.getByRole("button", { name: /Individual Race/i });
		expect(race).toBeEnabled();
			expect(screen.getByRole("button", { name: /Solo VQA Practice/i })).toBeEnabled();
		fireEvent.click(race);
		expect(screen.getByRole("heading", { name: "Start an Individual Race" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "30 seconds" })).toBeChecked();

		fireEvent.click(screen.getByRole("button", { name: /Back to room modes/i }));
		fireEvent.click(screen.getByRole("button", { name: /Solo Challenge/i }));
		expect(screen.getByLabelText("Current route")).toHaveTextContent("/live/challenge/pancreas-case-35");
	});

	it("offers playlist races outside Case 35", () => {
		renderDialog("34");
		const race = screen.getByRole("button", { name: /Individual Race/i });
		expect(race).toBeEnabled();
		fireEvent.click(race);
		expect(screen.getByRole("radio", { name: /Case 35/i })).toBeDisabled();
	});

	it("preserves the existing collaborative room form", () => {
		renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /Collaborative Review/i }));

		expect(screen.getByRole("heading", { name: "Start a Live Room" })).toBeInTheDocument();
		expect(screen.getByLabelText("Display name")).toBeInTheDocument();
	});
});
