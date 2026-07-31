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
	it("offers the curated case-35 solo challenge and keeps later stages disabled", () => {
		renderDialog();

		const solo = screen.getByRole("button", { name: /Solo Challenge/i });
		expect(solo).toBeEnabled();
		expect(screen.getByRole("button", { name: /Individual Race/i })).toBeDisabled();
		expect(screen.getByRole("button", { name: /Assignment/i })).toBeDisabled();

		fireEvent.click(solo);
		expect(screen.getByLabelText("Current route")).toHaveTextContent("/live/challenge/pancreas-case-35");
	});

	it("preserves the existing collaborative room form", () => {
		renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /Collaborative Review/i }));

		expect(screen.getByRole("heading", { name: "Start a Live Room" })).toBeInTheDocument();
		expect(screen.getByLabelText("Display name")).toBeInTheDocument();
	});
});
