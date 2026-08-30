import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Header from "../components/Header";
import { AuthProvider } from "../contexts/authContext";
import { CONTACT_URL, NAV_CONTACT_LABEL } from "../helpers/copy";

const renderHeader = () =>
  render(
    <AuthProvider>
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    </AuthProvider>,
  );

describe("header navigation", () => {
  it("keeps the four routed tabs and adds an external CONTACT entry", () => {
    renderHeader();
    for (const label of ["OVERVIEW", "DATASET", "UPLOAD", "TEAM"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    const contact = screen.getByRole("link", { name: new RegExp(`^${NAV_CONTACT_LABEL} `) });
    expect(contact).toHaveTextContent(NAV_CONTACT_LABEL);
    expect(contact).toHaveAttribute("href", CONTACT_URL);
    expect(contact).toHaveAttribute("target", "_blank");
    expect(contact).toHaveAttribute("rel", "noopener noreferrer");
  });
});
