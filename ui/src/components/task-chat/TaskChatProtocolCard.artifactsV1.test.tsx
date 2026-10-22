// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueWorkProduct } from "@paperclipai/shared";
import { ThemeProvider } from "@/context/ThemeContext";
import { MemoryRouter } from "@/lib/router";
import { TaskChatProtocolCard } from "./TaskChatProtocolCard";
import type { TaskChatProtocolItem } from "./task-chat-model";

vi.mock("@/hooks/useArtifactsV1Enabled", () => ({ useArtifactsV1Enabled: () => ({ enabled: true, loaded: true }) }));

const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000001";

const deckPdf = {
  id: "work-product-1",
  companyId: "company-1",
  projectId: null,
  issueId: "issue-1",
  executionWorkspaceId: null,
  runtimeServiceId: null,
  type: "artifact",
  provider: "paperclip",
  externalId: null,
  title: "Interface Craft revision — PDF",
  url: null,
  status: "ready_for_review",
  reviewState: "none",
  isPrimary: false,
  healthStatus: "unknown",
  summary: null,
  metadata: {
    attachmentId: ATTACHMENT_ID,
    contentType: "application/pdf",
    byteSize: 59085,
    contentPath: `/api/attachments/${ATTACHMENT_ID}/content`,
    openPath: `/api/attachments/${ATTACHMENT_ID}/content?inline=1`,
    downloadPath: `/api/attachments/${ATTACHMENT_ID}/content?download=1`,
    originalFilename: "acmehats-interface-craft.pdf",
  },
  createdByRunId: null,
  createdAt: new Date("2026-09-28T11:07:00Z"),
  updatedAt: new Date("2026-09-28T11:07:00Z"),
} as unknown as IssueWorkProduct;

describe("TaskChatProtocolCard resources with Artifacts V1 on", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  const render = (item: TaskChatProtocolItem) =>
    flushSync(() =>
      root.render(
        <MemoryRouter>
          <ThemeProvider>
            <TaskChatProtocolCard item={item} />
          </ThemeProvider>
        </MemoryRouter>,
      ),
    );

  it("renders a registered file as one row named after the file, with its size and state, opening where the card did", () => {
    render({ id: "resource:deliverable:work-product-1", kind: "protocol", surface: "resource", resourceKind: "deliverable", title: deckPdf.title, subtitle: "file · ready for review", href: `/api/attachments/${ATTACHMENT_ID}/content?inline=1`, workProduct: deckPdf });
    const row = container.querySelector('[data-testid="task-chat-resource-deliverable"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("acmehats-interface-craft.pdf");
    expect(row?.textContent).toContain("57.7 KB");
    expect(row?.textContent).toContain("PDF");
    expect(row?.querySelector<HTMLAnchorElement>('a[data-testid="task-chat-resource-deliverable-open"]')?.getAttribute("href")).toBe(`/api/attachments/${ATTACHMENT_ID}/content?inline=1`);
    expect(container.querySelector('[data-testid="task-chat-rich-work-product-artifact"]')).toBeNull();
  });

  it("renders a task document as a row named after its key that stays in the app", () => {
    render({
      id: "resource:document:plan",
      kind: "protocol",
      surface: "resource",
      resourceKind: "document",
      title: "Launch plan",
      subtitle: "Document · rev 1",
      href: "#document-plan",
      document: { id: "doc-plan", issueId: "issue-1", key: "plan", title: "Launch plan", format: "markdown", latestRevisionNumber: 1, createdByAgentId: null, updatedByAgentId: null, createdAt: new Date("2026-09-27T08:36:00Z"), updatedAt: new Date("2026-09-27T08:36:00Z") } as never,
    });
    const row = container.querySelector('[data-testid="task-chat-resource-document"]');
    expect(row?.textContent).toContain("plan.md");
    expect(row?.textContent).toContain("DOC");
    const link = row?.querySelector<HTMLAnchorElement>('a[data-testid="task-chat-resource-document-open"]');
    expect(link?.getAttribute("href")).toBe("#document-plan");
    expect(link?.getAttribute("target")).toBeNull();
  });
});
