// @vitest-environment jsdom

import type { IssueAttachment } from "@paperclipai/shared";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/context/ThemeContext";
import { IssueGalleryContext } from "@/context/IssueGalleryContext";
import { TaskChatBubble } from "./TaskChatBubble";

vi.mock("@/hooks/useArtifactsV1Enabled", () => ({ useArtifactsV1Enabled: () => ({ enabled: true, loaded: true }) }));

const attachment = (overrides: Partial<IssueAttachment>): IssueAttachment =>
  ({
    id: "a",
    companyId: "company-1",
    issueId: "issue-1",
    issueCommentId: null,
    assetId: "asset",
    provider: "local",
    objectKey: "file",
    contentType: "application/octet-stream",
    byteSize: 1024,
    originalFilename: "file",
    createdByAgentId: null,
    createdByUserId: null,
    createdAt: new Date("2026-09-28T11:07:00Z"),
    updatedAt: new Date("2026-09-28T11:07:00Z"),
    contentPath: "/api/attachments/a/content",
    ...overrides,
  }) as IssueAttachment;

describe("TaskChatBubble with Artifacts V1 on", () => {
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

  it("hangs a message's files under its footer as one group of rows, in place of the media grid and file chips", () => {
    const openGallery = vi.fn(() => true);
    const image = attachment({ id: "img", originalFilename: "contact-sheet.png", contentType: "image/png", byteSize: 433050, contentPath: "/api/attachments/img/content" });
    const pdf = attachment({ id: "r1", originalFilename: "report.pdf", contentType: "application/pdf", byteSize: 59085, contentPath: "/api/attachments/r1/content", openPath: "/api/attachments/r1/content?inline=1" });
    flushSync(() =>
      root.render(
        <ThemeProvider>
          <IssueGalleryContext.Provider value={openGallery}>
            <TaskChatBubble
              item={{ id: "m1", kind: "message", author: "agent", text: "Done.\n\n![Proof](/api/attachments/img/content)\n\n[report.pdf](/api/attachments/r1/content)", timestamp: "11:08 AM" }}
              attachments={[image, pdf]}
            />
          </IssueGalleryContext.Provider>
        </ThemeProvider>,
      ),
    );
    const group = container.querySelector('[data-testid="task-chat-bubble-artifacts-v1"]');
    expect(group).not.toBeNull();
    expect(container.querySelector('[data-testid="task-chat-bubble-media"]')).toBeNull();
    expect(container.querySelector('[data-testid="task-chat-bubble-attachments"]')).toBeNull();
    const rows = group!.querySelectorAll('[data-testid="artifact-v1-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("contact-sheet.png");
    expect(rows[0].textContent).toContain("422.9 KB");
    expect(rows[1].textContent).toContain("report.pdf");
    expect(rows[1].textContent).toContain("PDF");
    // The group follows the footer line.
    const timestamp = Array.from(container.querySelectorAll("span")).find((el) => el.textContent === "11:08 AM");
    expect(timestamp).toBeDefined();
    expect(timestamp!.compareDocumentPosition(group!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Pictures open the task's gallery; files open in a new tab.
    flushSync(() => rows[0].querySelector<HTMLButtonElement>('[data-testid="artifact-v1-row-open"]')!.click());
    expect(openGallery).toHaveBeenCalledWith("/api/attachments/img/content");
    const fileLink = rows[1].querySelector<HTMLAnchorElement>('a[data-testid="artifact-v1-row-open"]');
    expect(fileLink?.getAttribute("href")).toBe("/api/attachments/r1/content?inline=1");
    expect(fileLink?.getAttribute("target")).toBe("_blank");
  });

  it("renders no group when a message has no files", () => {
    flushSync(() =>
      root.render(
        <ThemeProvider>
          <TaskChatBubble item={{ id: "m2", kind: "message", author: "agent", text: "Just words.", timestamp: "11:09 AM" }} />
        </ThemeProvider>,
      ),
    );
    expect(container.querySelector('[data-testid="task-chat-bubble-artifacts-v1"]')).toBeNull();
    expect(container.textContent).toContain("Just words.");
  });
});
