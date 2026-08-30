import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SiteFooter from "../components/SiteFooter";
import {
  CONTACT_LINK_TEXT,
  CONTACT_URL,
  FOOTER_TAGLINE,
  NONCLINICAL_WARNING,
} from "../helpers/copy";

describe("site footer", () => {
  it("shows the tagline, the nonclinical notice, and the inquiry link", () => {
    render(<SiteFooter />);
    expect(screen.getByText(FOOTER_TAGLINE)).toBeInTheDocument();
    expect(screen.getByText(NONCLINICAL_WARNING)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: CONTACT_LINK_TEXT });
    expect(link).toHaveAttribute("href", CONTACT_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/contact BodyMaps, Inc\. through/)).toBeInTheDocument();
  });

  it("no longer uses the generic commercial-use wording", () => {
    render(<SiteFooter />);
    expect(screen.queryByText(/For commercial use/)).not.toBeInTheDocument();
  });
});
