// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactRow, ArtifactRowGroup, inlineRowStyle, splitName } from "./ArtifactRow";
import { testSubject } from "./test-subject";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: null, selectedCompanyId: null, companies: [] }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date("2026-09-28T18:00:00");

describe("splitName", () => {
  it("keeps the extension apart so the name can truncate", () => {
    expect(splitName("acmehats-interface-craft.pdf")).toEqual(["acmehats-interface-craft", ".pdf"]);
    expect(splitName("Storefront preview")).toEqual(["Storefront preview", ""]);
  });
});

describe("ArtifactRow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("names the file over its size and date, with the document icon's type label", () => {
    act(() => root.render(<ArtifactRow subject={testSubject({ kind: "pdf", filename: "deck.pdf", sizeLabel: "57.7 KB", updatedAt: "2026-09-27T08:00:00" })} now={NOW} />));
    const row = container.querySelector('button[data-testid="artifact-v1-row"]');
    expect(row?.getAttribute("aria-label")).toBe("Open deck.pdf");
    expect(row?.textContent).toContain("57.7 KB");
    expect(row?.textContent).toContain("Yesterday");
    expect(row?.textContent).toContain("PDF");
  });

  it("is a link when it has somewhere to go, and shows a thumbnail for a picture", () => {
    act(() =>
      root.render(
        <MemoryRouter>
          <ArtifactRow subject={testSubject({ kind: "image", filename: "contact-sheet.png", thumbnailUrl: "/sheet.png" })} to="/artifacts/a1" now={NOW} />
        </MemoryRouter>,
      ),
    );
    const link = container.querySelector('a[data-testid="artifact-v1-row"]');
    expect(link?.getAttribute("href")).toBe("/artifacts/a1");
    expect(link?.querySelector("img")?.getAttribute("src")).toBe("/sheet.png");
  });

  it("groups several rows inline at equal widths that wrap past 280px each", () => {
    act(() =>
      root.render(
        <ArtifactRowGroup>
          {[1, 2, 3].map((i) => (
            <ArtifactRow key={i} subject={testSubject({ kind: "pdf", filename: `deck-${i}.pdf` })} style={inlineRowStyle} now={NOW} />
          ))}
        </ArtifactRowGroup>,
      ),
    );
    const rows = container.querySelectorAll<HTMLElement>('[data-testid="artifact-v1-row"]');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.style.flex).toBe("1 0 280px");
  });
});
